import { spawn, spawnSync } from 'node:child_process';
import type { AutomationDeps } from './windows.js';

export const LINUX_AUTOMATION_SCRIPT_VERSION = 'linux-autologin-v17';
const DEFAULT_LINUX_AUTOMATION_CREDENTIAL_DELAY_MS = 4000;
const DEFAULT_LINUX_AUTOMATION_CREDENTIAL_RETRY_INTERVAL_MS = 1200;
const DEFAULT_LINUX_AUTOMATION_LOOP_MAX_ITERATIONS = 360;
const DEFAULT_LINUX_AUTOMATION_CREDENTIAL_TAB_COUNT = 0;
const DEFAULT_LINUX_AUTOMATION_CREDENTIAL_ANCHOR_X_PERCENT = 0.66;
const DEFAULT_LINUX_AUTOMATION_CREDENTIAL_ANCHOR_Y_PERCENT = 0.43;
const DEFAULT_LINUX_AUTOMATION_CREDENTIAL_ANCHOR_X_PIXEL_OFFSET = -200;
const DEFAULT_LINUX_AUTOMATION_CREDENTIAL_ANCHOR_Y_PIXEL_OFFSET = 100;
const DEFAULT_LINUX_AUTOMATION_PLAY_FIRST_DELAY_MS = 3000;
const DEFAULT_LINUX_AUTOMATION_PLAY_RETRY_INTERVAL_MS = 3500;
const DEFAULT_LINUX_AUTOMATION_MAX_PLAY_ATTEMPTS = 8;
const DEFAULT_LINUX_AUTOMATION_PLAY_X_PERCENT = 0.738;
const DEFAULT_LINUX_AUTOMATION_PLAY_Y_PERCENT = 0.725;

export type LinuxAutomationTimingOptions = {
  credentialDelayMs?: number;
  credentialRetryIntervalMs?: number;
  loopMaxIterations?: number;
  credentialTabCount?: number;
};

function normalizeInteger(value: number | undefined, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.round(Number(value))));
}

export function startLinuxCredentialAutomation(
  accountId: string,
  pid: number,
  email: string,
  password: string,
  bypassPortalPrompt = false,
  playClickXPercent?: number,
  playClickYPercent?: number,
  timingOptions?: LinuxAutomationTimingOptions,
  deps?: AutomationDeps,
): void {
  if (!deps) return;
  if (process.platform !== 'linux') return;
  const normalizedPlayClickXPercent = Number.isFinite(playClickXPercent)
    ? Math.max(0, Math.min(1, Number(playClickXPercent)))
    : undefined;
  const normalizedPlayClickYPercent = Number.isFinite(playClickYPercent)
    ? Math.max(0, Math.min(1, Number(playClickYPercent)))
    : undefined;
  const resolvedCredentialDelayMs = normalizeInteger(
    timingOptions?.credentialDelayMs,
    500,
    20000,
    DEFAULT_LINUX_AUTOMATION_CREDENTIAL_DELAY_MS,
  );
  const resolvedCredentialRetryIntervalMs = normalizeInteger(
    timingOptions?.credentialRetryIntervalMs,
    400,
    5000,
    DEFAULT_LINUX_AUTOMATION_CREDENTIAL_RETRY_INTERVAL_MS,
  );
  const resolvedLoopMaxIterations = normalizeInteger(
    timingOptions?.loopMaxIterations,
    120,
    1200,
    DEFAULT_LINUX_AUTOMATION_LOOP_MAX_ITERATIONS,
  );
  const resolvedCredentialTabCount = normalizeInteger(
    timingOptions?.credentialTabCount,
    0,
    30,
    DEFAULT_LINUX_AUTOMATION_CREDENTIAL_TAB_COUNT,
  );
  const hasCustomPlayClick = typeof normalizedPlayClickXPercent === 'number' && typeof normalizedPlayClickYPercent === 'number';
  deps.logMain(
    'automation',
    `Linux automation start account=${accountId} pid=${pid} emailLen=${email.length} script=${LINUX_AUTOMATION_SCRIPT_VERSION} customPlayClick=${hasCustomPlayClick ? `${normalizedPlayClickXPercent},${normalizedPlayClickYPercent}` : 'none'} credentialDelayMs=${resolvedCredentialDelayMs} credentialRetryMs=${resolvedCredentialRetryIntervalMs} loopMaxIterations=${resolvedLoopMaxIterations} credentialTabs=${resolvedCredentialTabCount}`,
  );

  const xdotoolCheck = spawnSync('which', ['xdotool'], { encoding: 'utf8' });
  if (xdotoolCheck.status !== 0) {
    deps.logMainError('automation', 'Credential automation on Linux requires xdotool to be installed.');
    return;
  }

  const automationScript = `
log_automation() {
  printf '[gw2am-automation] %s\\n' "$1" >&2
}

log_automation "script-start pid=$GW2_PID version=${LINUX_AUTOMATION_SCRIPT_VERSION}"
log_automation "mode=deterministic-launcher-flow"

sanitize_uint() {
  local value="$1"
  local fallback="$2"
  case "$value" in
    ''|*[!0-9]*)
      echo "$fallback"
      ;;
    *)
      echo "$value"
      ;;
  esac
}

credential_delay_after_window_detect_ms="$(sanitize_uint "\${GW2_CREDENTIAL_DELAY_MS:-}" ${DEFAULT_LINUX_AUTOMATION_CREDENTIAL_DELAY_MS})"
window_detected_ms=0
credentials_submitted_ms=0
play_click_not_before_ms=0
play_attempt_count=0
max_play_attempts=${DEFAULT_LINUX_AUTOMATION_MAX_PLAY_ATTEMPTS}
last_play_attempt_ms=0
seen_window=0
credential_submitted=0
credential_attempt_count=0
last_credential_attempt_ms=0
credential_attempt_interval_ms="$(sanitize_uint "\${GW2_CREDENTIAL_RETRY_INTERVAL_MS:-}" ${DEFAULT_LINUX_AUTOMATION_CREDENTIAL_RETRY_INTERVAL_MS})"
credential_tab_count="$(sanitize_uint "\${GW2_CREDENTIAL_TAB_COUNT:-}" ${DEFAULT_LINUX_AUTOMATION_CREDENTIAL_TAB_COUNT})"
max_loop_iterations="$(sanitize_uint "\${GW2_LOOP_MAX_ITERATIONS:-}" ${DEFAULT_LINUX_AUTOMATION_LOOP_MAX_ITERATIONS})"
max_credential_attempts=5
credential_anchor_offset_x_px=${DEFAULT_LINUX_AUTOMATION_CREDENTIAL_ANCHOR_X_PIXEL_OFFSET}
credential_anchor_offset_y_px=${DEFAULT_LINUX_AUTOMATION_CREDENTIAL_ANCHOR_Y_PIXEL_OFFSET}
activation_throttle_ms=1200
last_activation_ms=0
launcher_window_class=""
launcher_window_name=""
play_attempt_interval_ms=${DEFAULT_LINUX_AUTOMATION_PLAY_RETRY_INTERVAL_MS}
last_email_verify_result="unknown"
log_automation "timing credentialDelayMs=$credential_delay_after_window_detect_ms credentialRetryMs=$credential_attempt_interval_ms loopMaxIterations=$max_loop_iterations credentialTabs=$credential_tab_count maxCredentialAttempts=$max_credential_attempts"
has_custom_play_click=0
if [ -n "\${GW2_PLAY_X_PERCENT:-}" ] && [ -n "\${GW2_PLAY_Y_PERCENT:-}" ]; then
  has_custom_play_click=1
  log_automation "play-coordinate custom x=$GW2_PLAY_X_PERCENT y=$GW2_PLAY_Y_PERCENT"
fi

release_modifiers() {
  xdotool keyup Shift_L Shift_R Control_L Control_R Alt_L Alt_R Super_L Super_R 2>/dev/null || true
}

is_blocking_prompt_visible() {
  if [ "\${GW2_BYPASS_PORTAL_PROMPT:-0}" = "1" ]; then
    return 1
  fi
  if xdotool search --onlyvisible --name "Legacy X11 App Support" 2>/dev/null >/dev/null; then
    return 0
  fi
  if xdotool search --onlyvisible --name "Remote Desktop" 2>/dev/null >/dev/null; then
    return 0
  fi
  if xdotool search --onlyvisible --name "Input Capture" 2>/dev/null >/dev/null; then
    return 0
  fi
  return 1
}

find_launcher_window() {
  local id=""
  if [ -n "$GW2_PID" ] && [ "$GW2_PID" -gt 0 ] 2>/dev/null; then
    id="$(xdotool search --onlyvisible --pid "$GW2_PID" 2>/dev/null | head -n 1)"
  fi
  if [ -z "$id" ]; then
    id="$(xdotool search --onlyvisible --name 'Guild Wars 2' 2>/dev/null | head -n 1)"
  fi
  if [ -z "$id" ]; then
    id="$(xdotool search --onlyvisible --name 'Guild Wars' 2>/dev/null | head -n 1)"
  fi
  if [ -z "$id" ]; then
    id="$(xdotool search --onlyvisible --name 'ArenaNet' 2>/dev/null | head -n 1)"
  fi
  echo "$id"
}

activate_launcher_window() {
  local now_ms="$1"
  if [ "$now_ms" -gt 0 ] 2>/dev/null && [ "$last_activation_ms" -gt 0 ] 2>/dev/null; then
    if [ $((now_ms - last_activation_ms)) -lt "$activation_throttle_ms" ]; then
      return 0
    fi
  fi
  xdotool windowraise "$win_id" 2>/dev/null || true
  xdotool windowactivate --sync "$win_id" 2>/dev/null || return 1
  xdotool windowfocus --sync "$win_id" 2>/dev/null || true
  local active_id
  active_id="$(xdotool getactivewindow 2>/dev/null || true)"
  last_activation_ms="\${now_ms:-0}"
  [ "$active_id" = "$win_id" ]
}

get_window_name() {
  xdotool getwindowname "$win_id" 2>/dev/null || true
}

get_window_class() {
  xdotool getwindowclassname "$win_id" 2>/dev/null || true
}

is_launcher_identity() {
  local current_class current_name
  current_class="$(get_window_class)"
  current_name="$(get_window_name)"

  if [ -n "$launcher_window_class" ] && [ -n "$current_class" ] && [ "$current_class" != "$launcher_window_class" ]; then
    return 1
  fi

  case "$current_name" in
    *Guild\\ Wars*|*ArenaNet*)
      return 0
      ;;
  esac

  if [ -n "$launcher_window_name" ] && [ "$current_name" = "$launcher_window_name" ]; then
    return 0
  fi
  return 1
}

get_window_geometry() {
  eval "$(xdotool getwindowgeometry --shell "$win_id" 2>/dev/null)" || return 1
  if [ -z "$WIDTH" ] || [ -z "$HEIGHT" ]; then
    return 1
  fi
  if [ "$WIDTH" -lt 120 ] || [ "$HEIGHT" -lt 120 ]; then
    return 1
  fi
  return 0
}

click_client_point() {
  local x="$1"
  local y="$2"
  xdotool mousemove --window "$win_id" "$x" "$y" 2>/dev/null || return 1
  xdotool click --window "$win_id" 1 2>/dev/null || xdotool click 1 2>/dev/null || return 1
  sleep 0.07
  return 0
}

send_tab_count() {
  local count="$1"
  if [ -z "$count" ] || [ "$count" -le 0 ] 2>/dev/null; then
    return 0
  fi
  for _ in $(seq 1 "$count"); do
    xdotool key --clearmodifiers --window "$win_id" Tab || return 1
  done
  return 0
}

clear_focused_input() {
  xdotool key --clearmodifiers ctrl+a 2>/dev/null || xdotool key --clearmodifiers --window "$win_id" ctrl+a 2>/dev/null || true
  sleep 0.06
  xdotool key --clearmodifiers BackSpace 2>/dev/null || xdotool key --clearmodifiers --window "$win_id" BackSpace 2>/dev/null || true
  sleep 0.06
}

set_clipboard_text() {
  local value="$1"
  if command -v wl-copy >/dev/null 2>&1; then
    printf '%s' "$value" | wl-copy >/dev/null 2>&1 || return 1
    return 0
  fi
  if command -v xclip >/dev/null 2>&1; then
    printf '%s' "$value" | xclip -selection clipboard >/dev/null 2>&1 || return 1
    return 0
  fi
  if command -v xsel >/dev/null 2>&1; then
    printf '%s' "$value" | xsel --clipboard --input >/dev/null 2>&1 || return 1
    return 0
  fi
  return 1
}

paste_into_focused() {
  local value="$1"
  set_clipboard_text "$value" || return 1
  clear_focused_input
  xdotool key --clearmodifiers ctrl+v 2>/dev/null || xdotool key --clearmodifiers --window "$win_id" ctrl+v 2>/dev/null || return 1
  sleep 0.2
  return 0
}

type_into_focused() {
  local value="$1"
  clear_focused_input
  xdotool type --clearmodifiers --delay 1 -- "$value" 2>/dev/null || xdotool type --clearmodifiers --window "$win_id" --delay 1 -- "$value" 2>/dev/null || return 1
  sleep 0.2
  return 0
}

get_clipboard_text() {
  if command -v wl-paste >/dev/null 2>&1; then
    wl-paste --no-newline 2>/dev/null || return 1
    return 0
  fi
  if command -v xclip >/dev/null 2>&1; then
    xclip -selection clipboard -o 2>/dev/null || return 1
    return 0
  fi
  if command -v xsel >/dev/null 2>&1; then
    xsel --clipboard --output 2>/dev/null || return 1
    return 0
  fi
  return 1
}

enter_text_strict() {
  local value="$1"
  local method="\${2:-type}"
  if [ "$method" = "type" ]; then
    if type_into_focused "$value"; then
      log_automation "input-method method=type len=\${#value}"
      return 0
    fi
    paste_into_focused "$value" || return 1
    log_automation "input-method method=paste-fallback len=\${#value}"
    return 0
  fi
  if paste_into_focused "$value"; then
    log_automation "input-method method=paste len=\${#value}"
    return 0
  fi
  type_into_focused "$value" || return 1
  log_automation "input-method method=type-fallback len=\${#value}"
  return 0
}

read_focused_input_text() {
  local marker="__GW2AM_NO_COPY__$(date +%s%N)"
  if ! set_clipboard_text "$marker"; then
    echo ""
    return 0
  fi
  xdotool key --clearmodifiers ctrl+a 2>/dev/null || xdotool key --clearmodifiers --window "$win_id" ctrl+a 2>/dev/null || true
  sleep 0.08
  xdotool key --clearmodifiers ctrl+c 2>/dev/null || xdotool key --clearmodifiers --window "$win_id" ctrl+c 2>/dev/null || true
  sleep 0.1
  local text
  text="$(get_clipboard_text 2>/dev/null | tr -d '\r\n' || true)"
  if [ "$text" = "$marker" ]; then
    echo "__GW2AM_NO_COPY__"
    return 0
  fi
  echo "$text"
  return 0
}

verify_email_field() {
  local expected="$1"
  local probe
  last_email_verify_result="unknown"
  probe="$(read_focused_input_text)"
  if [ "$probe" = "__GW2AM_NO_COPY__" ]; then
    last_email_verify_result="non-copyable"
    log_automation "input-verify-inconclusive reason=non-copyable expectedLen=\${#expected}"
    return 0
  fi
  if [ -z "$probe" ]; then
    last_email_verify_result="empty"
    log_automation "input-verify-inconclusive reason=empty expectedLen=\${#expected}"
    return 0
  fi
  local expected_norm probe_norm
  expected_norm="$(printf '%s' "$expected" | tr '[:upper:]' '[:lower:]')"
  probe_norm="$(printf '%s' "$probe" | tr '[:upper:]' '[:lower:]')"
  if [ "$probe_norm" = "$expected_norm" ]; then
    last_email_verify_result="matched"
    return 0
  fi
  last_email_verify_result="mismatch"
  log_automation "input-verify-failed reason=mismatch expectedLen=\${#expected} actualLen=\${#probe}"
  return 1
}

press_tab() {
  xdotool key --clearmodifiers --window "$win_id" Tab 2>/dev/null || xdotool key --clearmodifiers Tab 2>/dev/null || return 1
  sleep 0.11
  return 0
}

press_enter() {
  xdotool key --clearmodifiers --window "$win_id" Return 2>/dev/null || xdotool key --clearmodifiers Return 2>/dev/null || return 1
  sleep 0.11
  return 0
}

submit_gw2launcher_once() {
  local tabs="$1"
  local anchor_x_percent="$2"
  local anchor_y_percent="$3"
  if [ -z "$anchor_x_percent" ]; then anchor_x_percent="${DEFAULT_LINUX_AUTOMATION_CREDENTIAL_ANCHOR_X_PERCENT}"; fi
  if [ -z "$anchor_y_percent" ]; then anchor_y_percent="${DEFAULT_LINUX_AUTOMATION_CREDENTIAL_ANCHOR_Y_PERCENT}"; fi
  release_modifiers
  activate_launcher_window "$(date +%s%3N)" || return 1
  get_window_geometry || return 1

  local cx cy
  cx="$(awk -v w="$WIDTH" -v p="$anchor_x_percent" 'BEGIN { printf("%d", w * p) }')"
  cy="$(awk -v h="$HEIGHT" -v p="$anchor_y_percent" 'BEGIN { printf("%d", h * p) }')"
  cx=$((cx + credential_anchor_offset_x_px))
  cy=$((cy + credential_anchor_offset_y_px))
  if [ "$cx" -lt 20 ]; then cx=20; fi
  if [ "$cy" -lt 20 ]; then cy=20; fi
  if [ "$cx" -gt $((WIDTH - 20)) ]; then cx=$((WIDTH - 20)); fi
  if [ "$cy" -gt $((HEIGHT - 20)) ]; then cy=$((HEIGHT - 20)); fi

  log_automation "focus-anchor x=$cx y=$cy xPct=$anchor_x_percent yPct=$anchor_y_percent win_w=$WIDTH win_h=$HEIGHT"
  click_client_point "$cx" "$cy" || return 1
  send_tab_count "$tabs" || return 1
  log_automation "email-anchor tabs=$tabs"
  sleep 0.15
  enter_text_strict "$GW2_EMAIL" || return 1
  verify_email_field "$GW2_EMAIL" || return 1
  if [ "$last_email_verify_result" != "matched" ] && [ "$tabs" -gt 0 ] 2>/dev/null; then
    local retry_tabs
    retry_tabs=$((tabs - 1))
    log_automation "email-anchor-retry tabs=$retry_tabs previousTabs=$tabs reason=$last_email_verify_result"
    release_modifiers
    click_client_point "$cx" "$cy" || return 1
    send_tab_count "$retry_tabs" || return 1
    log_automation "email-anchor tabs=$retry_tabs"
    sleep 0.15
    enter_text_strict "$GW2_EMAIL" || return 1
    verify_email_field "$GW2_EMAIL" || return 1
  fi
  sleep 0.18
  release_modifiers
  press_tab || return 1
  log_automation "password-anchor tabs=$tabs"
  sleep 0.18
  enter_text_strict "$GW2_PASSWORD" || return 1
  sleep 0.2
  release_modifiers
  press_enter || return 1
  log_automation "gw2launcher-submit tabs=$tabs strategy=click-tab-type-tab-type-enter"
  return 0
}

click_play_button() {
  local attempt="$1"
  get_window_geometry || return 1
  local cx cy

  if [ "$has_custom_play_click" -eq 1 ]; then
    cx="$(awk -v w="$WIDTH" -v p="$GW2_PLAY_X_PERCENT" 'BEGIN { printf("%d", w * p) }')"
    cy="$(awk -v h="$HEIGHT" -v p="$GW2_PLAY_Y_PERCENT" 'BEGIN { printf("%d", h * p) }')"
    if [ "$cx" -lt 20 ]; then cx=20; fi
    if [ "$cy" -lt 20 ]; then cy=20; fi
    if [ "$cx" -gt $((WIDTH - 20)) ]; then cx=$((WIDTH - 20)); fi
    if [ "$cy" -gt $((HEIGHT - 20)) ]; then cy=$((HEIGHT - 20)); fi
    if click_client_point "$cx" "$cy"; then
      log_automation "play-click profile=custom x=$cx y=$cy win_w=$WIDTH win_h=$HEIGHT attempt=$attempt"
      return 0
    fi
  fi

  cx="$(awk -v w="$WIDTH" 'BEGIN { printf("%d", w * ${DEFAULT_LINUX_AUTOMATION_PLAY_X_PERCENT}) }')"
  cy="$(awk -v h="$HEIGHT" 'BEGIN { printf("%d", h * ${DEFAULT_LINUX_AUTOMATION_PLAY_Y_PERCENT}) }')"
  if click_client_point "$cx" "$cy"; then
    log_automation "play-click profile=default x=$cx y=$cy win_w=$WIDTH win_h=$HEIGHT attempt=$attempt"
    return 0
  fi

  return 1
}

for i in $(seq 1 "$max_loop_iterations"); do
  sleep 0.4

  if is_blocking_prompt_visible; then
    log_automation "waiting-for-blocking-prompt"
    sleep 1.0
    continue
  fi

  win_id="$(find_launcher_window)"
  if [ -z "$win_id" ] || ! [ "$win_id" -gt 0 ] 2>/dev/null; then
    continue
  fi

  now_epoch_ms="$(date +%s%3N)"
  if [ "$seen_window" -eq 0 ]; then
    seen_window=1
    window_detected_ms="$now_epoch_ms"
    log_automation "window-detected id=$win_id"
    launcher_window_class="$(get_window_class)"
    launcher_window_name="$(get_window_name)"
    log_automation "window-identity class=\${launcher_window_class:-unknown} name=\${launcher_window_name:-unknown}"
    if get_window_geometry; then
      log_automation "window-geometry x=$X y=$Y width=$WIDTH height=$HEIGHT"
    fi
    log_automation "credentials-delay-start wait_ms=$credential_delay_after_window_detect_ms"
  fi

  if [ "$credential_submitted" -eq 0 ]; then
    if ! activate_launcher_window "$now_epoch_ms"; then
      continue
    fi
    elapsed_ms=$((now_epoch_ms - window_detected_ms))
    if [ "$elapsed_ms" -lt "$credential_delay_after_window_detect_ms" ]; then
      continue
    fi

    if [ $((now_epoch_ms - last_credential_attempt_ms)) -lt "$credential_attempt_interval_ms" ]; then
      continue
    fi
    last_credential_attempt_ms="$now_epoch_ms"

    if [ "$credential_attempt_count" -ge "$max_credential_attempts" ]; then
      log_automation "credentials-aborted reason=max-attempts attempts=$credential_attempt_count"
      exit 1
    fi
    current_attempt=$((credential_attempt_count + 1))
    current_tabs="$credential_tab_count"
    current_anchor_x="${DEFAULT_LINUX_AUTOMATION_CREDENTIAL_ANCHOR_X_PERCENT}"
    current_anchor_y="${DEFAULT_LINUX_AUTOMATION_CREDENTIAL_ANCHOR_Y_PERCENT}"
    if submit_gw2launcher_once "$current_tabs" "$current_anchor_x" "$current_anchor_y"; then
      credential_submitted=1
      credential_attempt_count="$current_attempt"
      credentials_submitted_ms="$(date +%s%3N)"
      play_click_not_before_ms=$((credentials_submitted_ms + ${DEFAULT_LINUX_AUTOMATION_PLAY_FIRST_DELAY_MS}))
      log_automation "credentials-submitted attempt=$credential_attempt_count mode=gw2launcher-flow tabs=$current_tabs"
      continue
    fi

    credential_attempt_count="$current_attempt"
    if [ "$credential_attempt_count" -ge "$max_credential_attempts" ]; then
      log_automation "credentials-aborted reason=entry-failed attempts=$credential_attempt_count tabs=$current_tabs"
      exit 1
    fi
    log_automation "credentials-retry reason=entry-failed attempt=$credential_attempt_count tabs=$current_tabs"
    continue
  fi

  if [ "$credential_submitted" -eq 0 ]; then
    continue
  fi
  if [ "$now_epoch_ms" -lt "$play_click_not_before_ms" ]; then
    continue
  fi
  if [ $((now_epoch_ms - last_play_attempt_ms)) -lt "$play_attempt_interval_ms" ]; then
    continue
  fi

  if ! is_launcher_identity; then
    log_automation "play-loop-stopped reason=non-launcher-window class=$(get_window_class) name=$(get_window_name)"
    exit 0
  fi

  clicked_play=0
  if click_play_button "$play_attempt_count"; then
    clicked_play=1
  fi
  play_attempt_count=$((play_attempt_count + 1))
  last_play_attempt_ms="$now_epoch_ms"
  log_automation "play-attempt attempt=$play_attempt_count clicked=$clicked_play"
  sleep 0.35
  if ! is_launcher_identity; then
    log_automation "play-loop-stopped reason=non-launcher-window-post-click class=$(get_window_class) name=$(get_window_name)"
    exit 0
  fi
  if [ "$play_attempt_count" -ge "$max_play_attempts" ]; then
    log_automation "script-finished max-play-attempts reached"
    exit 0
  fi
done

log_automation "script-finished timeout-or-loop-end credentialAttempts=$credential_attempt_count playAttempts=$play_attempt_count"
exit 1
`;

  const automationProcess = spawn(
    '/bin/bash',
    ['-c', automationScript],
    {
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        GW2_PID: String(pid),
        GW2_EMAIL: email,
        GW2_PASSWORD: password,
        GW2_BYPASS_PORTAL_PROMPT: bypassPortalPrompt ? '1' : '0',
        GW2_PLAY_X_PERCENT: typeof normalizedPlayClickXPercent === 'number' ? String(normalizedPlayClickXPercent) : '',
        GW2_PLAY_Y_PERCENT: typeof normalizedPlayClickYPercent === 'number' ? String(normalizedPlayClickYPercent) : '',
        GW2_CREDENTIAL_DELAY_MS: String(resolvedCredentialDelayMs),
        GW2_CREDENTIAL_RETRY_INTERVAL_MS: String(resolvedCredentialRetryIntervalMs),
        GW2_LOOP_MAX_ITERATIONS: String(resolvedLoopMaxIterations),
        GW2_CREDENTIAL_TAB_COUNT: String(resolvedCredentialTabCount),
      },
    },
  );
  automationProcess.stdout?.on('data', (buf) => {
    deps.logMain('automation', `Linux automation stdout account=${accountId}: ${String(buf).trim()}`);
  });
  automationProcess.stderr?.on('data', (buf) => {
    const output = String(buf).trim();
    deps.logMainWarn('automation', `Linux automation stderr account=${accountId}: ${output}`);
  });
  automationProcess.on('error', (error) => {
    deps.logMainError('automation', `Linux automation error account=${accountId}: ${error.message}`);
  });
  automationProcess.on('exit', (code, signal) => {
    deps.logMain('automation', `Linux automation exit account=${accountId}: code=${code ?? 'null'} signal=${signal ?? 'null'}`);
  });
  deps.trackAutomationProcess(accountId, automationProcess.pid);
  deps.logMain('automation', `Linux automation spawned account=${accountId} pid=${automationProcess.pid ?? 'unknown'}`);
  automationProcess.unref();
}

import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import '@axiapps/axi-design/axi.css';
import '@axiapps/axi-design/accents.css';
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
        <App />
    </React.StrictMode>,
)

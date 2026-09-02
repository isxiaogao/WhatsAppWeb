import { createApp } from 'vue'
import App from './App.vue'
import { initializeControlApi } from './api/runtime-config'
import './assets/main.css'

await initializeControlApi()
createApp(App).mount('#app')

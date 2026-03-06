// src/config.js
// Centralized configuration for API endpoints

const BASE_URL = "192.168.10.191:8000"; // Local Django server
// const BASE_URL = "192.168.10.191:8000";

// Use http:// and ws:// for local development
export const API_URL = `http://${BASE_URL}`;
export const WS_URL = `ws://${BASE_URL}`;

// For convenience, you can also export the full base URL
const config = {
    API_URL,
    WS_URL,
    BASE_URL,
};

export default config;
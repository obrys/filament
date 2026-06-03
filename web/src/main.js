import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Link } from 'react-router-dom';
import { Dashboard } from './pages/Dashboard';
import { FilamentTypes } from './pages/FilamentTypes';
import { Spools } from './pages/Spools';
import { SpoolDetail } from './pages/SpoolDetail';
import { useChangeStream } from './realtime/useChangeStream';
import './styles.css';
function App() {
    useChangeStream();
    return (_jsxs(BrowserRouter, { children: [_jsxs("header", { className: "topbar", children: [_jsx(Link, { to: "/", className: "brand", children: "\uD83E\uDDF5 Filament" }), _jsxs("nav", { children: [_jsx(Link, { to: "/", children: "Dashboard" }), _jsx(Link, { to: "/types", children: "Types" }), _jsx(Link, { to: "/spools", children: "Spools" })] })] }), _jsx("main", { children: _jsxs(Routes, { children: [_jsx(Route, { path: "/", element: _jsx(Dashboard, {}) }), _jsx(Route, { path: "/types", element: _jsx(FilamentTypes, {}) }), _jsx(Route, { path: "/spools", element: _jsx(Spools, {}) }), _jsx(Route, { path: "/spools/:id", element: _jsx(SpoolDetail, {}) })] }) })] }));
}
ReactDOM.createRoot(document.getElementById('root')).render(_jsx(React.StrictMode, { children: _jsx(App, {}) }));

// ==========================================================================
// Configuration & State
// ==========================================================================
const API_BASE = "/api";
const WS_PROTOCOL = window.location.protocol === "https:" ? "wss" : "ws";
const WS_BASE = `${WS_PROTOCOL}://${window.location.host}/ws`;

let state = {
    token: localStorage.getItem("token") || null,
    user: null,
    tasks: [],
    viewMode: localStorage.getItem("viewMode") || "kanban",
    ws: null,
    wsReconnectTimeout: null,
    searchQuery: "",
    priorityFilter: "",
    statusFilter: "",
    tagFilter: "",
    sortBy: "created_at",
    page: 1,
    pageSize: 20,
    totalTasks: 0,
    sortables: [],
    charts: { status: null, priority: null },
    notifCount: 0,
    nlpDebounce: null,
};

// ==========================================================================
// App Initialization
// ==========================================================================
document.addEventListener("DOMContentLoaded", () => {
    hideColdStart();
    initTheme();
    initApp();
});

async function hideColdStart() {
    const overlay = document.getElementById("cold-start-overlay");
    if (!overlay) return;
    // Try pinging the backend — hide overlay once it responds
    const MAX_WAIT = 15000;
    const start = Date.now();
    while (Date.now() - start < MAX_WAIT) {
        try {
            const r = await fetch(`${API_BASE}/auth/me`, { signal: AbortSignal.timeout(2000) });
            // Got a response (even 401 means server is up)
            break;
        } catch { await new Promise(r => setTimeout(r, 800)); }
    }
    overlay.classList.add("fade-out");
    setTimeout(() => overlay.remove(), 700);
}

async function initApp() {
    if (state.token) {
        const ok = await fetchCurrentUser();
        ok ? showDashboard() : (clearToken(), showAuth());
    } else {
        showAuth();
    }
}

// ==========================================================================
// Theme Management
// ==========================================================================
function initTheme() {
    const saved = localStorage.getItem("theme") || "dark";
    document.documentElement.setAttribute("data-theme", saved);
    updateThemeIcon(saved);
    document.getElementById("theme-toggle").addEventListener("click", () => {
        const cur = document.documentElement.getAttribute("data-theme");
        const next = cur === "dark" ? "light" : "dark";
        document.documentElement.setAttribute("data-theme", next);
        localStorage.setItem("theme", next);
        updateThemeIcon(next);
        // Re-render charts with new colors
        if (state.charts.status) renderCharts();
    });
}
function updateThemeIcon(theme) {
    const icon = document.querySelector("#theme-toggle i");
    if (icon) icon.className = theme === "dark" ? "fa-solid fa-sun" : "fa-solid fa-moon";
}

// ==========================================================================
// Authentication
// ==========================================================================
function switchAuthTab(tab) {
    document.querySelectorAll(".auth-tab").forEach(el => el.classList.remove("active"));
    document.querySelectorAll(".auth-form").forEach(el => el.classList.remove("active"));
    document.getElementById(`tab-${tab}`).classList.add("active");
    document.getElementById(`${tab}-form`).classList.add("active");
}

async function fetchCurrentUser() {
    try {
        const res = await fetch(`${API_BASE}/auth/me`, {
            headers: { Authorization: `Bearer ${state.token}` }
        });
        if (res.ok) { state.user = await res.json(); return true; }
    } catch { }
    return false;
}

async function handleAuth(e, type) {
    e.preventDefault();
    const username = document.getElementById(`${type}-username`).value.trim();
    const password = document.getElementById(`${type}-password`).value;

    // Frontend validation
    let valid = true;
    if (username.length < 3) {
        showFieldError(`err-${type}-username`, "Username must be at least 3 characters");
        valid = false;
    }
    if (password.length < 4) {
        showFieldError(`err-${type}-password`, "Password must be at least 4 characters");
        valid = false;
    }
    if (!valid) return;

    try {
        if (type === "register") {
            const res = await fetch(`${API_BASE}/auth/register`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ username, password })
            });
            const data = await res.json();
            if (res.ok) {
                showToast("Account Created", "Logging you in…", "success");
                await autoLogin(username, password);
            } else {
                showFieldError("err-register-username", data.detail || "Registration failed");
            }
        } else {
            await autoLogin(username, password);
        }
    } catch {
        showToast("Connection Error", "Cannot reach server", "error");
    }
}

async function autoLogin(username, password) {
    const form = new URLSearchParams({ username, password });
    const res = await fetch(`${API_BASE}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: form
    });
    const data = await res.json();
    if (res.ok) {
        state.token = data.access_token;
        localStorage.setItem("token", data.access_token);
        await fetchCurrentUser();
        showToast("Welcome", `Logged in as ${state.user.username}`, "success");
        showDashboard();
        requestNotificationPermission();
    } else {
        showFieldError("err-login-password", data.detail || "Invalid credentials");
    }
}

function logout() {
    clearToken();
    if (state.ws) state.ws.close();
    clearTimeout(state.wsReconnectTimeout);
    destroySortables();
    showAuth();
    showToast("Logged Out", "See you later!", "info");
}

function clearToken() {
    state.token = null;
    state.user = null;
    state.tasks = [];
    localStorage.removeItem("token");
}

// Inline form validation helpers
function showFieldError(id, msg) {
    const el = document.getElementById(id);
    if (el) { el.textContent = msg; }
    // also mark the input red
    const inputId = id.replace("err-", "");
    const input = document.getElementById(inputId);
    if (input) input.classList.add("error-field");
}
function clearFieldError(input) {
    input.classList.remove("error-field");
    const errEl = document.getElementById("err-" + input.id);
    if (errEl) errEl.textContent = "";
}

// Registration live validators
function validateRegisterUsername(input) {
    clearFieldError(input);
    if (input.value.length > 0 && input.value.length < 3)
        showFieldError("err-register-username", "Min 3 characters required");
}
function validateRegisterPassword(input) {
    clearFieldError(input);
    if (input.value.length > 0 && input.value.length < 4)
        showFieldError("err-register-password", "Min 4 characters required");
}

// ── Screens ──────────────────────────────────────────────────────────────────
function showAuth() {
    document.getElementById("auth-screen").classList.remove("hidden");
    document.getElementById("dashboard-screen").classList.add("hidden");
    renderUserPanel();
}

function showDashboard() {
    document.getElementById("auth-screen").classList.add("hidden");
    document.getElementById("dashboard-screen").classList.remove("hidden");
    document.getElementById("notif-btn").classList.remove("hidden");
    setViewMode(state.viewMode);
    renderUserPanel();
    loadTasks();
    connectWebSocket();
    startDeadlineChecker();
}

function renderUserPanel() {
    const panel = document.getElementById("user-panel");
    if (state.user) {
        const initials = state.user.username.substring(0, 2).toUpperCase();
        const color = avatarColor(state.user.username);
        panel.innerHTML = `
            <div class="user-profile" onclick="openProfileModal()" title="View profile">
                <div class="user-avatar" style="background:${color}">${initials}</div>
                <span class="user-name">${state.user.username}</span>
            </div>
            <button class="icon-btn" title="Log Out" onclick="logout()">
                <i class="fa-solid fa-right-from-bracket"></i>
            </button>`;
    } else {
        panel.innerHTML = "";
    }
}

function avatarColor(name) {
    const colors = [
        "linear-gradient(135deg,#6366f1,#8b5cf6)",
        "linear-gradient(135deg,#06b6d4,#3b82f6)",
        "linear-gradient(135deg,#f59e0b,#ef4444)",
        "linear-gradient(135deg,#10b981,#059669)",
        "linear-gradient(135deg,#ec4899,#8b5cf6)",
        "linear-gradient(135deg,#f97316,#eab308)",
    ];
    let hash = 0;
    for (let c of name) hash = (hash * 31 + c.charCodeAt(0)) & 0xffffffff;
    return colors[Math.abs(hash) % colors.length];
}

// ==========================================================================
// Task Filtering / Status click
// ==========================================================================
function filterByStatus(status) {
    state.statusFilter = status;
    state.page = 1;
    loadTasks();
}

function handleSearchFilter() {
    state.searchQuery   = document.getElementById("search-input").value;
    state.priorityFilter = document.getElementById("priority-filter").value;
    state.sortBy        = document.getElementById("sort-by").value;
    state.page = 1;
    loadTasks();
}

function clearTagFilter() {
    state.tagFilter = "";
    document.getElementById("tag-filter-bar").classList.add("hidden");
    loadTasks();
}

function setTagFilter(tag) {
    state.tagFilter = tag;
    state.page = 1;
    const bar = document.getElementById("tag-filter-bar");
    const chip = document.getElementById("active-tag-chip");
    chip.textContent = tag;
    chip.setAttribute("data-color", tagColor(tag));
    bar.classList.remove("hidden");
    loadTasks();
}

// ==========================================================================
// Tasks API — Load
// ==========================================================================
async function loadTasks() {
    if (!state.token) return;
    const params = new URLSearchParams();
    if (state.searchQuery)    params.append("search", state.searchQuery);
    if (state.priorityFilter) params.append("priority_filter", state.priorityFilter);
    if (state.statusFilter)   params.append("status_filter", state.statusFilter);
    if (state.tagFilter)      params.append("tag_filter", state.tagFilter);
    if (state.sortBy)         params.append("sort_by", state.sortBy);
    params.append("page", state.page);
    params.append("page_size", state.pageSize);

    const url = `${API_BASE}/tasks?${params}`;
    try {
        const res = await fetch(url, { headers: { Authorization: `Bearer ${state.token}` } });
        if (res.ok) {
            state.tasks = await res.json();
            state.totalTasks = parseInt(res.headers.get("X-Total-Count") || state.tasks.length);
            renderTasks();
            renderStats();
            renderCharts();
            renderPagination();
            checkOverdueNotifications();
        } else if (res.status === 401) {
            logout();
        }
    } catch (err) {
        showToast("Sync Error", "Could not fetch tasks", "error");
    }
}

// ==========================================================================
// Render — Tasks (Kanban / List)
// ==========================================================================
function renderTasks() {
    state.viewMode === "kanban" ? renderKanbanBoard() : renderListView();
}

function setViewMode(mode) {
    state.viewMode = mode;
    localStorage.setItem("viewMode", mode);
    document.getElementById("view-kanban").classList.toggle("active", mode === "kanban");
    document.getElementById("view-list").classList.toggle("active", mode === "list");
    document.getElementById("kanban-view").classList.toggle("hidden", mode !== "kanban");
    document.getElementById("list-view").classList.toggle("hidden", mode !== "list");
    if (mode === "kanban") {
        renderKanbanBoard();
        initSortables();
    } else {
        renderListView();
        destroySortables();
    }
}

// ── Kanban ───────────────────────────────────────────────────────────────────
function renderKanbanBoard() {
    const cols = {
        todo:        document.getElementById("cards-todo"),
        in_progress: document.getElementById("cards-in_progress"),
        done:        document.getElementById("cards-done"),
    };
    Object.values(cols).forEach(c => c.innerHTML = "");
    const counts = { todo: 0, in_progress: 0, done: 0 };

    state.tasks.forEach(task => {
        if (cols[task.status]) {
            counts[task.status]++;
            cols[task.status].appendChild(createTaskCard(task));
        }
    });

    document.getElementById("badge-todo").textContent        = counts.todo;
    document.getElementById("badge-in-progress").textContent = counts.in_progress;
    document.getElementById("badge-done").textContent        = counts.done;

    Object.values(cols).forEach(c => {
        if (!c.children.length) {
            c.innerHTML = `<div class="empty-placeholder">
                <i class="fa-solid fa-clipboard-question"></i>
                <p>Drop tasks here</p>
            </div>`;
        }
    });

    initSortables();
}

function createTaskCard(task) {
    const card = document.createElement("div");
    card.className = "task-card";
    card.setAttribute("data-id", task.id);
    card.setAttribute("draggable", "false"); // SortableJS handles drag

    const today = new Date().toISOString().split("T")[0];
    const isOverdue = task.due_date && task.due_date < today && task.status !== "done";
    if (isOverdue) card.classList.add("overdue-card");

    const priorityLabel = task.priority.charAt(0).toUpperCase() + task.priority.slice(1);
    const dueTag = task.due_date ? `
        <div class="badge-tag due-tag ${isOverdue ? "overdue" : ""}">
            <i class="fa-regular fa-clock"></i> ${formatDate(task.due_date)}${isOverdue ? " ⚠️" : ""}
        </div>` : "";

    const tagChips = buildTagChips(task.tags, true);

    card.innerHTML = `
        <div class="card-header">
            <h3>${escapeHTML(task.title)}</h3>
            <div class="card-actions">
                <button class="action-icon edit" onclick="openTaskModal(${task.id})" title="Edit">
                    <i class="fa-solid fa-pen-to-square"></i>
                </button>
                <button class="action-icon delete" onclick="deleteTask(${task.id})" title="Delete">
                    <i class="fa-solid fa-trash-can"></i>
                </button>
            </div>
        </div>
        ${task.description ? `<div class="card-body">${escapeHTML(task.description)}</div>` : ""}
        ${tagChips ? `<div class="card-tags">${tagChips}</div>` : ""}
        <div class="card-tags">
            <div class="badge-tag priority-${task.priority}">
                <i class="fa-solid fa-circle-exclamation"></i> ${priorityLabel}
            </div>
            ${dueTag}
        </div>`;
    return card;
}

// ── SortableJS ───────────────────────────────────────────────────────────────
function initSortables() {
    destroySortables();
    const colIds = ["cards-todo", "cards-in_progress", "cards-done"];
    const statusMap = {
        "cards-todo": "todo",
        "cards-in_progress": "in_progress",
        "cards-done": "done",
    };

    colIds.forEach(colId => {
        const el = document.getElementById(colId);
        if (!el) return;
        const s = Sortable.create(el, {
            group: "tasks",
            animation: 180,
            ghostClass: "sortable-ghost",
            chosenClass: "sortable-chosen",
            dragClass: "sortable-drag",
            onEnd: async (evt) => {
                const taskId = evt.item.getAttribute("data-id");
                const newStatus = statusMap[evt.to.id];
                if (!taskId || !newStatus) return;

                const task = state.tasks.find(t => t.id == taskId);
                if (!task || task.status === newStatus) return;

                const original = task.status;
                task.status = newStatus;
                renderStats();
                renderCharts();

                try {
                    const res = await fetch(`${API_BASE}/tasks/${taskId}`, {
                        method: "PUT",
                        headers: {
                            "Content-Type": "application/json",
                            Authorization: `Bearer ${state.token}`
                        },
                        body: JSON.stringify({ status: newStatus })
                    });
                    if (!res.ok) {
                        task.status = original;
                        renderTasks();
                        showToast("Sync Error", "Could not update task status", "error");
                    }
                } catch {
                    task.status = original;
                    renderTasks();
                }
            }
        });
        state.sortables.push(s);
    });
}

function destroySortables() {
    state.sortables.forEach(s => { try { s.destroy(); } catch { } });
    state.sortables = [];
}

// ── List View ────────────────────────────────────────────────────────────────
function renderListView() {
    const tbody = document.getElementById("list-tbody");
    tbody.innerHTML = "";
    const today = new Date().toISOString().split("T")[0];

    if (!state.tasks.length) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:40px;color:var(--text-muted);">
            <i class="fa-solid fa-clipboard-question" style="font-size:2rem;display:block;margin-bottom:10px;opacity:0.4;"></i>
            No tasks found
        </td></tr>`;
        return;
    }

    state.tasks.forEach(task => {
        const isOverdue = task.due_date && task.due_date < today && task.status !== "done";
        const row = document.createElement("tr");
        if (isOverdue) row.classList.add("overdue-row");
        const statusLabel = { todo: "To Do", in_progress: "In Progress", done: "Completed" }[task.status] || task.status;
        const dueStr = task.due_date ? formatDate(task.due_date) : "-";
        row.innerHTML = `
            <td>
                <div class="list-task-info">
                    <h4>${escapeHTML(task.title)}</h4>
                    <p>${escapeHTML(task.description || "No description")}</p>
                </div>
            </td>
            <td><div class="list-tags">${buildTagChips(task.tags, true)}</div></td>
            <td><span class="status-pill ${task.status}">${statusLabel}</span></td>
            <td><span class="badge-tag priority-${task.priority}">${task.priority.charAt(0).toUpperCase() + task.priority.slice(1)}</span></td>
            <td><span class="due-text ${isOverdue ? "overdue" : ""}">${dueStr}${isOverdue ? " ⚠️" : ""}</span></td>
            <td class="actions-col">
                <div class="list-actions">
                    <button class="action-icon edit" onclick="openTaskModal(${task.id})"><i class="fa-solid fa-pen-to-square"></i></button>
                    <button class="action-icon delete" onclick="deleteTask(${task.id})"><i class="fa-solid fa-trash-can"></i></button>
                </div>
            </td>`;
        tbody.appendChild(row);
    });
}

// ==========================================================================
// Stats & Charts
// ==========================================================================
function renderStats() {
    const today = new Date().toISOString().split("T")[0];
    const total      = state.totalTasks;
    const todo       = state.tasks.filter(t => t.status === "todo").length;
    const inProgress = state.tasks.filter(t => t.status === "in_progress").length;
    const done       = state.tasks.filter(t => t.status === "done").length;
    const overdue    = state.tasks.filter(t => t.due_date && t.due_date < today && t.status !== "done").length;

    document.getElementById("stat-total").textContent      = total;
    document.getElementById("stat-todo").textContent       = todo;
    document.getElementById("stat-in-progress").textContent = inProgress;
    document.getElementById("stat-done").textContent       = done;
    document.getElementById("stat-overdue").textContent    = overdue;
}

function renderCharts() {
    const isDark = document.documentElement.getAttribute("data-theme") === "dark";
    const textColor = isDark ? "rgba(255,255,255,0.6)" : "rgba(0,0,0,0.5)";
    const today = new Date().toISOString().split("T")[0];

    const todo       = state.tasks.filter(t => t.status === "todo").length;
    const inProgress = state.tasks.filter(t => t.status === "in_progress").length;
    const done       = state.tasks.filter(t => t.status === "done").length;
    const high   = state.tasks.filter(t => t.priority === "high").length;
    const medium = state.tasks.filter(t => t.priority === "medium").length;
    const low    = state.tasks.filter(t => t.priority === "low").length;

    const chartDefaults = {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            legend: { labels: { color: textColor, font: { family: "Inter", size: 12 }, boxWidth: 14, padding: 12 } }
        }
    };

    // Status Doughnut
    const sCtx = document.getElementById("status-chart")?.getContext("2d");
    if (sCtx) {
        if (state.charts.status) state.charts.status.destroy();
        state.charts.status = new Chart(sCtx, {
            type: "doughnut",
            data: {
                labels: ["To Do", "In Progress", "Completed"],
                datasets: [{
                    data: [todo, inProgress, done],
                    backgroundColor: ["rgba(249,115,22,0.8)", "rgba(168,85,247,0.8)", "rgba(34,197,94,0.8)"],
                    borderColor: isDark ? "rgba(30,41,59,1)" : "rgba(255,255,255,1)",
                    borderWidth: 3,
                    hoverOffset: 8,
                }]
            },
            options: { ...chartDefaults, cutout: "68%" }
        });
    }

    // Priority Bar
    const pCtx = document.getElementById("priority-chart")?.getContext("2d");
    if (pCtx) {
        if (state.charts.priority) state.charts.priority.destroy();
        state.charts.priority = new Chart(pCtx, {
            type: "bar",
            data: {
                labels: ["High", "Medium", "Low"],
                datasets: [{
                    label: "Tasks",
                    data: [high, medium, low],
                    backgroundColor: [
                        "rgba(239,68,68,0.75)",
                        "rgba(249,115,22,0.75)",
                        "rgba(59,130,246,0.75)",
                    ],
                    borderRadius: 8,
                    borderSkipped: false,
                }]
            },
            options: {
                ...chartDefaults,
                scales: {
                    y: { ticks: { color: textColor, stepSize: 1 }, grid: { color: isDark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.05)" } },
                    x: { ticks: { color: textColor }, grid: { display: false } }
                },
                plugins: { ...chartDefaults.plugins, legend: { display: false } }
            }
        });
    }
}

// ==========================================================================
// Pagination
// ==========================================================================
function renderPagination() {
    const bar = document.getElementById("pagination-bar");
    const totalPages = Math.ceil(state.totalTasks / state.pageSize);

    if (totalPages <= 1) { bar.classList.add("hidden"); return; }
    bar.classList.remove("hidden");

    document.getElementById("page-indicator").textContent = `Page ${state.page} of ${totalPages}`;
    document.getElementById("page-prev").disabled = state.page <= 1;
    document.getElementById("page-next").disabled = state.page >= totalPages;
}

function changePage(delta) {
    const totalPages = Math.ceil(state.totalTasks / state.pageSize);
    state.page = Math.max(1, Math.min(state.page + delta, totalPages));
    loadTasks();
    window.scrollTo({ top: 0, behavior: "smooth" });
}

// ==========================================================================
// Tags Helpers
// ==========================================================================
function parseTags(tagStr) {
    if (!tagStr) return [];
    return tagStr.split(",").map(t => t.trim()).filter(Boolean);
}

function tagColor(tag) {
    let hash = 0;
    for (let c of tag) hash = (hash * 31 + c.charCodeAt(0)) & 0xffffffff;
    return Math.abs(hash) % 8;
}

function buildTagChips(tagStr, clickable = false) {
    return parseTags(tagStr).map(tag => {
        const color = tagColor(tag);
        const onclick = clickable ? `onclick="setTagFilter('${escapeHTML(tag)}')"` : "";
        return `<span class="tag-chip" data-color="${color}" title="Filter by: ${escapeHTML(tag)}" ${onclick}>${escapeHTML(tag)}</span>`;
    }).join("");
}

function updateTagPreview() {
    const input = document.getElementById("task-tags");
    const preview = document.getElementById("tag-preview");
    if (!input || !preview) return;
    const tags = parseTags(input.value);
    preview.innerHTML = tags.map(t => `<span class="tag-chip" data-color="${tagColor(t)}">${escapeHTML(t)}</span>`).join("");
    // Validate
    if (tags.length > 8) {
        showFieldError("err-task-tags", "Maximum 8 tags allowed");
    } else {
        const errEl = document.getElementById("err-task-tags");
        if (errEl) errEl.textContent = "";
    }
}

// ==========================================================================
// AI / NLP — scikit-learn categorizer integration
// ==========================================================================
async function onTitleInput(input) {
    clearFieldError(input);
    updateTagPreview();

    const text = (input.value + " " + (document.getElementById("task-description")?.value || "")).trim();
    if (text.length < 5) {
        document.getElementById("ai-suggestion").classList.add("hidden");
        return;
    }

    clearTimeout(state.nlpDebounce);
    state.nlpDebounce = setTimeout(async () => {
        if (!state.token) return;
        try {
            const res = await fetch(`${API_BASE}/ai/categorize`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${state.token}`
                },
                body: JSON.stringify({ text })
            });
            if (!res.ok) return;
            const data = await res.json();

            // Apply suggested priority to the select
            const prioritySelect = document.getElementById("task-priority");
            if (prioritySelect && data.suggested_priority) {
                prioritySelect.value = data.suggested_priority;
            }

            // Suggest tags (prepend to existing)
            if (data.suggested_tags?.length) {
                const tagsInput = document.getElementById("task-tags");
                if (tagsInput && !tagsInput.value.trim()) {
                    tagsInput.value = data.suggested_tags.slice(0, 3).join(", ");
                    updateTagPreview();
                }
            }

            // Show AI suggestion badge
            const badge = document.getElementById("ai-suggestion");
            const badgeText = document.getElementById("ai-suggestion-text");
            const pct = Math.round(data.confidence * 100);
            badgeText.textContent = `Category: ${data.category} (${pct}% confidence) — Priority: ${data.suggested_priority}`;
            badge.classList.remove("hidden");
        } catch { /* silent fail */ }
    }, 600);
}

function validateDueDate(input) {
    const hint = document.getElementById("hint-task-due-date");
    const err = document.getElementById("err-task-due-date");
    if (!input.value) { if (hint) hint.textContent = ""; return; }
    const today = new Date().toISOString().split("T")[0];
    if (input.value < today) {
        if (hint) hint.textContent = "⚠️ This date is in the past";
        if (err) err.textContent = "";
    } else {
        if (hint) hint.textContent = "";
    }
}

// ==========================================================================
// Task CRUD Modal
// ==========================================================================
function openTaskModal(taskId = null) {
    const modal = document.getElementById("task-modal");
    document.getElementById("task-form").reset();
    document.getElementById("task-id-input").value = "";
    document.getElementById("ai-suggestion").classList.add("hidden");
    document.getElementById("tag-preview").innerHTML = "";
    document.querySelectorAll(".field-error").forEach(el => el.textContent = "");
    document.querySelectorAll(".error-field").forEach(el => el.classList.remove("error-field"));
    if (document.getElementById("hint-task-due-date"))
        document.getElementById("hint-task-due-date").textContent = "";

    if (taskId) {
        const task = state.tasks.find(t => t.id === taskId);
        if (!task) return;
        document.getElementById("modal-title").textContent = "Edit Task";
        document.getElementById("task-submit-btn").textContent = "Save Changes";
        document.getElementById("task-id-input").value = task.id;
        document.getElementById("task-title").value = task.title;
        document.getElementById("task-description").value = task.description || "";
        document.getElementById("task-status").value = task.status;
        document.getElementById("task-priority").value = task.priority;
        document.getElementById("task-due-date").value = task.due_date || "";
        document.getElementById("task-tags").value = task.tags || "";
        updateTagPreview();
    } else {
        document.getElementById("modal-title").textContent = "Create New Task";
        document.getElementById("task-submit-btn").textContent = "Create Task";
    }
    modal.classList.remove("hidden");
    setTimeout(() => document.getElementById("task-title").focus(), 100);
}

function closeTaskModal() {
    document.getElementById("task-modal").classList.add("hidden");
}

function handleOutsideModalClick(e) {
    if (e.target.id === "task-modal") closeTaskModal();
}

async function handleTaskSubmit(e) {
    e.preventDefault();
    const idInput = document.getElementById("task-id-input").value;
    const title   = document.getElementById("task-title").value.trim();
    const desc    = document.getElementById("task-description").value.trim();
    const status  = document.getElementById("task-status").value;
    const priority = document.getElementById("task-priority").value;
    const due_date = document.getElementById("task-due-date").value || null;
    const tags    = document.getElementById("task-tags").value.trim() || null;

    // Validation
    let valid = true;
    if (title.length < 3) {
        showFieldError("err-task-title", "Title must be at least 3 characters");
        valid = false;
    }
    if (title.length > 200) {
        showFieldError("err-task-title", "Title must be under 200 characters");
        valid = false;
    }
    if (tags && parseTags(tags).length > 8) {
        showFieldError("err-task-tags", "Maximum 8 tags allowed");
        valid = false;
    }
    if (!valid) return;

    const payload = { title, description: desc, status, priority, due_date, tags };
    const method = idInput ? "PUT" : "POST";
    const url    = idInput ? `${API_BASE}/tasks/${idInput}` : `${API_BASE}/tasks`;

    try {
        const res = await fetch(url, {
            method,
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${state.token}` },
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (res.ok) {
            closeTaskModal();
            showToast(idInput ? "Task Updated" : "Task Created", `"${title}" saved.`, "success");
            loadTasks();
        } else {
            const detail = typeof data.detail === "string"
                ? data.detail
                : (data.detail?.[0]?.msg || "Could not save task");
            showFieldError("err-task-title", detail);
        }
    } catch {
        showToast("Network Error", "Cannot connect to server", "error");
    }
}

async function deleteTask(taskId) {
    if (!confirm("Permanently delete this task?")) return;
    try {
        const res = await fetch(`${API_BASE}/tasks/${taskId}`, {
            method: "DELETE",
            headers: { Authorization: `Bearer ${state.token}` }
        });
        if (res.ok) {
            showToast("Deleted", "Task removed successfully", "success");
            loadTasks();
        } else {
            const d = await res.json();
            showToast("Error", d.detail || "Could not delete", "error");
        }
    } catch {
        showToast("Error", "Network error", "error");
    }
}

// ==========================================================================
// User Profile Modal
// ==========================================================================
async function openProfileModal() {
    if (!state.user) return;
    const modal = document.getElementById("profile-modal");

    const initials = state.user.username.substring(0, 2).toUpperCase();
    const color = avatarColor(state.user.username);
    document.getElementById("profile-avatar-large").style.background = color;
    document.getElementById("profile-avatar-large").textContent = initials;
    document.getElementById("profile-username").textContent = state.user.username;

    const today = new Date().toISOString().split("T")[0];
    const total   = state.tasks.length;
    const done    = state.tasks.filter(t => t.status === "done").length;
    const overdue = state.tasks.filter(t => t.due_date && t.due_date < today && t.status !== "done").length;
    const high    = state.tasks.filter(t => t.priority === "high").length;
    const medium  = state.tasks.filter(t => t.priority === "medium").length;
    const low     = state.tasks.filter(t => t.priority === "low").length;
    const pct     = total ? Math.round((done / total) * 100) : 0;

    document.getElementById("ps-total").textContent      = total;
    document.getElementById("ps-done").textContent       = done;
    document.getElementById("ps-overdue").textContent    = overdue;
    document.getElementById("ps-completion").textContent = pct + "%";
    document.getElementById("ps-high").textContent   = high;
    document.getElementById("ps-medium").textContent = medium;
    document.getElementById("ps-low").textContent    = low;

    modal.classList.remove("hidden");
}

function closeProfileModal(e) {
    if (!e || e.target.id === "profile-modal") {
        document.getElementById("profile-modal").classList.add("hidden");
    }
}

// ==========================================================================
// Browser Notifications + Deadline Checker
// ==========================================================================
function requestNotificationPermission() {
    if (!("Notification" in window)) return;
    if (Notification.permission === "default") {
        Notification.requestPermission().then(p => {
            if (p === "granted") showToast("Notifications On", "You'll get deadline alerts", "success");
        });
    }
}

function checkOverdueNotifications() {
    if (Notification.permission !== "granted") return;
    const today = new Date().toISOString().split("T")[0];
    const overdue = state.tasks.filter(t => t.due_date && t.due_date < today && t.status !== "done");
    const dueToday = state.tasks.filter(t => t.due_date === today && t.status !== "done");

    // Update badge
    const count = overdue.length + dueToday.length;
    const badge = document.getElementById("notif-badge");
    if (count > 0) {
        state.notifCount = count;
        badge.textContent = count;
        badge.classList.remove("hidden");
    } else {
        badge.classList.add("hidden");
    }

    // Fire browser notifications (max 2 per check to avoid spam)
    overdue.slice(0, 2).forEach(t => {
        new Notification(`⚠️ Overdue: ${t.title}`, {
            body: `Due ${formatDate(t.due_date)} — not yet completed`,
            icon: "/favicon.ico",
        });
    });
}

function startDeadlineChecker() {
    // Run once immediately after load, then every 5 minutes
    setTimeout(checkOverdueNotifications, 3000);
    setInterval(checkOverdueNotifications, 5 * 60 * 1000);
}

// ==========================================================================
// WebSocket Real-time Sync
// ==========================================================================
function connectWebSocket() {
    if (!state.token) return;
    clearTimeout(state.wsReconnectTimeout);
    const statusEl = document.getElementById("connection-status");
    const statusText = statusEl.querySelector(".status-text");

    try {
        state.ws = new WebSocket(WS_BASE);
        state.ws.onopen = () => {
            statusEl.className = "connection-status online";
            statusText.textContent = "Live";
        };
        state.ws.onmessage = (ev) => {
            try { handleWebSocketMessage(JSON.parse(ev.data)); } catch { }
        };
        state.ws.onclose = () => {
            statusEl.className = "connection-status offline";
            statusText.textContent = "Offline";
            state.wsReconnectTimeout = setTimeout(connectWebSocket, 5000);
        };
        state.ws.onerror = () => state.ws.close();
    } catch {
        statusEl.className = "connection-status offline";
        statusText.textContent = "Offline";
    }
}

function handleWebSocketMessage(msg) {
    if (!state.user) return;
    const isDiff = msg.sender !== state.user.username;
    if (!isDiff) return;

    if (msg.type === "TASK_CREATED" && msg.task?.owner_id === state.user.id) {
        loadTasks();
        showToast("Synced", `${msg.sender} added "${msg.task.title}"`, "info");
    } else if (msg.type === "TASK_UPDATED" && msg.task?.owner_id === state.user.id) {
        loadTasks();
        showToast("Synced", `${msg.sender} updated "${msg.task.title}"`, "info");
    } else if (msg.type === "TASK_DELETED") {
        if (state.tasks.some(t => t.id === msg.task_id)) {
            loadTasks();
            showToast("Synced", `${msg.sender} deleted a task`, "alert");
        }
    }
}

// ==========================================================================
// Toast Notifications
// ==========================================================================
function showToast(title, message, type = "info") {
    const container = document.getElementById("toast-container");
    const toast = document.createElement("div");
    const icons = { success: "fa-circle-check", alert: "fa-circle-exclamation", error: "fa-circle-xmark", info: "fa-circle-info" };
    const iconClass = `fa-solid ${icons[type] || icons.info}`;

    toast.className = `toast ${type}`;
    toast.innerHTML = `
        <div class="toast-icon"><i class="${iconClass}"></i></div>
        <div class="toast-body"><strong>${escapeHTML(title)}</strong><span>${escapeHTML(message)}</span></div>
        <button class="toast-close" onclick="dismissToast(this)"><i class="fa-solid fa-xmark"></i></button>`;
    toast.addEventListener("click", (e) => {
        if (!e.target.closest(".toast-close")) dismissToast(toast.querySelector(".toast-close"));
    });
    container.appendChild(toast);
    setTimeout(() => { if (toast.parentNode) dismissToast(toast.querySelector(".toast-close")); }, 5000);
}

function dismissToast(btn) {
    const toast = btn?.closest(".toast");
    if (!toast) return;
    toast.classList.add("fade-out");
    toast.addEventListener("animationend", () => toast.remove(), { once: true });
}

// ==========================================================================
// Utilities
// ==========================================================================
function escapeHTML(str) {
    if (!str) return "";
    return str.replace(/[&<>'"]/g, t => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[t]));
}

function formatDate(dateStr) {
    if (!dateStr) return "";
    const d = new Date(dateStr + "T00:00:00");
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

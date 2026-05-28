// ==========================================================================
// Application State & Configuration
// ==========================================================================
const API_BASE = "http://127.0.0.1:8000/api";
const WS_BASE = "ws://127.0.0.1:8000/ws";

let state = {
    token: localStorage.getItem("token") || null,
    user: null,
    tasks: [],
    viewMode: localStorage.getItem("viewMode") || "kanban",
    ws: null,
    wsReconnectTimeout: null,
    searchQuery: "",
    priorityFilter: ""
};

// ==========================================================================
// App Initialization
// ==========================================================================
document.addEventListener("DOMContentLoaded", () => {
    initTheme();
    initApp();
});

async function initApp() {
    if (state.token) {
        const success = await fetchCurrentUser();
        if (success) {
            showDashboard();
        } else {
            clearToken();
            showAuth();
        }
    } else {
        showAuth();
    }
}

// ==========================================================================
// Theme Management
// ==========================================================================
function initTheme() {
    const savedTheme = localStorage.getItem("theme") || "dark";
    document.documentElement.setAttribute("data-theme", savedTheme);
    updateThemeToggleIcon(savedTheme);

    const themeToggle = document.getElementById("theme-toggle");
    themeToggle.addEventListener("click", () => {
        const currentTheme = document.documentElement.getAttribute("data-theme");
        const newTheme = currentTheme === "dark" ? "light" : "dark";
        document.documentElement.setAttribute("data-theme", newTheme);
        localStorage.setItem("theme", newTheme);
        updateThemeToggleIcon(newTheme);
    });
}

function updateThemeToggleIcon(theme) {
    const icon = document.querySelector("#theme-toggle i");
    if (theme === "dark") {
        icon.className = "fa-solid fa-sun";
    } else {
        icon.className = "fa-solid fa-moon";
    }
}

// ==========================================================================
// Authentication Logic
// ==========================================================================
function switchAuthTab(tab) {
    document.querySelectorAll(".auth-tab").forEach(el => el.classList.remove("active"));
    document.querySelectorAll(".auth-form").forEach(el => el.classList.remove("active"));
    
    document.getElementById(`tab-${tab}`).classList.add("active");
    document.getElementById(`${tab}-form`).classList.add("active");
}

async function fetchCurrentUser() {
    try {
        const response = await fetch(`${API_BASE}/auth/me`, {
            headers: { "Authorization": `Bearer ${state.token}` }
        });
        if (response.ok) {
            state.user = await response.json();
            return true;
        }
        return false;
    } catch (err) {
        console.error("Error fetching current user:", err);
        return false;
    }
}

async function handleAuth(event, type) {
    event.preventDefault();
    const usernameInput = document.getElementById(`${type}-username`);
    const passwordInput = document.getElementById(`${type}-password`);
    
    const username = usernameInput.value.trim();
    const password = passwordInput.value;

    if (!username || !password) return;

    try {
        if (type === "register") {
            const response = await fetch(`${API_BASE}/auth/register`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ username, password })
            });

            const data = await response.json();
            if (response.ok) {
                showToast("Account Created", "Successfully registered! Logging you in...", "success");
                
                // Auto login after registration
                await autoLogin(username, password);
            } else {
                showToast("Registration Failed", data.detail || "Could not register user", "error");
            }
        } else {
            await autoLogin(username, password);
        }
    } catch (err) {
        console.error("Auth error:", err);
        showToast("Connection Error", "Could not connect to authentication server", "error");
    }
}

async function autoLogin(username, password) {
    // Uvicorn Form Data Login
    const formDetails = new URLSearchParams();
    formDetails.append("username", username);
    formDetails.append("password", password);

    const response = await fetch(`${API_BASE}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: formDetails
    });

    const data = await response.json();
    if (response.ok) {
        state.token = data.access_token;
        localStorage.setItem("token", data.access_token);
        
        await fetchCurrentUser();
        showToast("Welcome", `Logged in successfully as ${state.user.username}`, "success");
        showDashboard();
    } else {
        showToast("Login Failed", data.detail || "Invalid username or password", "error");
    }
}

function logout() {
    clearToken();
    if (state.ws) {
        state.ws.close();
    }
    clearTimeout(state.wsReconnectTimeout);
    showAuth();
    showToast("Logged Out", "You have been logged out of the workspace", "info");
}

function clearToken() {
    state.token = null;
    state.user = null;
    state.tasks = [];
    localStorage.removeItem("token");
}

function showAuth() {
    document.getElementById("auth-screen").classList.remove("hidden");
    document.getElementById("dashboard-screen").classList.add("hidden");
    renderUserPanel();
}

function showDashboard() {
    document.getElementById("auth-screen").classList.add("hidden");
    document.getElementById("dashboard-screen").classList.remove("hidden");
    
    // Set UI view button state
    setViewMode(state.viewMode);
    
    renderUserPanel();
    loadTasks();
    connectWebSocket();
}

function renderUserPanel() {
    const userPanel = document.getElementById("user-panel");
    if (state.user) {
        const initials = state.user.username.substring(0, 2).toUpperCase();
        userPanel.innerHTML = `
            <div class="user-profile">
                <div class="user-avatar">${initials}</div>
                <span class="user-name">${state.user.username}</span>
            </div>
            <button class="icon-btn" title="Log Out" onclick="logout()">
                <i class="fa-solid fa-right-from-bracket"></i>
            </button>
        `;
    } else {
        userPanel.innerHTML = "";
    }
}

// ==========================================================================
// Tasks Operations (CRUD & API integration)
// ==========================================================================
async function loadTasks() {
    if (!state.token) return;

    let url = `${API_BASE}/tasks`;
    const params = new URLSearchParams();
    if (state.searchQuery) params.append("search", state.searchQuery);
    if (state.priorityFilter) params.append("priority_filter", state.priorityFilter);
    
    if (params.toString()) {
        url += `?${params.toString()}`;
    }

    try {
        const response = await fetch(url, {
            headers: { "Authorization": `Bearer ${state.token}` }
        });
        if (response.ok) {
            state.tasks = await response.json();
            renderTasks();
            renderStats();
        } else if (response.status === 401) {
            logout();
        }
    } catch (err) {
        console.error("Error loading tasks:", err);
        showToast("Data Sync Error", "Unable to fetch tasks from server", "error");
    }
}

function renderTasks() {
    if (state.viewMode === "kanban") {
        renderKanbanBoard();
    } else {
        renderListView();
    }
}

function handleSearchFilter() {
    state.searchQuery = document.getElementById("search-input").value;
    state.priorityFilter = document.getElementById("priority-filter").value;
    loadTasks();
}

function setViewMode(mode) {
    state.viewMode = mode;
    localStorage.setItem("viewMode", mode);

    document.getElementById("view-kanban").classList.toggle("active", mode === "kanban");
    document.getElementById("view-list").classList.toggle("active", mode === "list");

    document.getElementById("kanban-view").classList.toggle("hidden", mode !== "kanban");
    document.getElementById("list-view").classList.toggle("hidden", mode !== "list");

    renderTasks();
}

// --- Kanban board View Renderer ---
function renderKanbanBoard() {
    const cols = {
        todo: document.getElementById("cards-todo"),
        in_progress: document.getElementById("cards-in_progress"),
        done: document.getElementById("cards-done")
    };

    // Clear columns
    Object.values(cols).forEach(el => el.innerHTML = "");

    const counts = { todo: 0, in_progress: 0, done: 0 };

    state.tasks.forEach(task => {
        if (cols[task.status]) {
            counts[task.status]++;
            const card = createTaskCard(task);
            cols[task.status].appendChild(card);
        }
    });

    // Update badges
    document.getElementById("badge-todo").innerText = counts.todo;
    document.getElementById("badge-in-progress").innerText = counts.in_progress;
    document.getElementById("badge-done").innerText = counts.done;

    // Render empty state placeholders if column is empty
    Object.entries(cols).forEach(([status, container]) => {
        if (container.children.length === 0) {
            container.innerHTML = `
                <div class="empty-placeholder">
                    <i class="fa-solid fa-clipboard-question"></i>
                    <p>No tasks here</p>
                </div>
            `;
        }
    });
}

function createTaskCard(task) {
    const card = document.createElement("div");
    card.className = "task-card";
    card.setAttribute("draggable", "true");
    card.setAttribute("data-id", task.id);
    
    // Drag events
    card.addEventListener("dragstart", handleDragStart);
    card.addEventListener("dragend", handleDragEnd);

    // Format priority badge
    const priorityClass = `priority-${task.priority}`;
    const priorityLabel = task.priority.charAt(0).toUpperCase() + task.priority.slice(1);

    // Format due date badge
    let dueTag = "";
    if (task.due_date) {
        const todayStr = new Date().toISOString().split("T")[0];
        const isOverdue = task.due_date < todayStr && task.status !== "done";
        dueTag = `
            <div class="badge-tag due-tag ${isOverdue ? 'overdue' : ''}">
                <i class="fa-regular fa-clock"></i> ${formatDate(task.due_date)}
            </div>
        `;
    }

    card.innerHTML = `
        <div class="card-header">
            <h3>${escapeHTML(task.title)}</h3>
            <div class="card-actions">
                <button class="action-icon edit" onclick="openTaskModal(${task.id})" title="Edit Task">
                    <i class="fa-solid fa-pen-to-square"></i>
                </button>
                <button class="action-icon delete" onclick="deleteTask(${task.id})" title="Delete Task">
                    <i class="fa-solid fa-trash-can"></i>
                </button>
            </div>
        </div>
        ${task.description ? `<div class="card-body">${escapeHTML(task.description)}</div>` : ''}
        <div class="card-tags">
            <div class="badge-tag ${priorityClass}">
                <i class="fa-solid fa-circle-exclamation"></i> ${priorityLabel}
            </div>
            ${dueTag}
        </div>
    `;

    return card;
}

// --- List View Renderer ---
function renderListView() {
    const tbody = document.getElementById("list-tbody");
    tbody.innerHTML = "";

    if (state.tasks.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="5" style="text-align: center; color: var(--text-muted); padding: 40px;">
                    <i class="fa-solid fa-clipboard-question" style="font-size: 2rem; margin-bottom: 12px; display: block; opacity: 0.5;"></i>
                    No tasks found matching your filters
                </td>
            </tr>
        `;
        return;
    }

    state.tasks.forEach(task => {
        const row = document.createElement("tr");

        const priorityLabel = task.priority.charAt(0).toUpperCase() + task.priority.slice(1);
        const statusLabel = task.status === "in_progress" ? "In Progress" : (task.status === "todo" ? "To Do" : "Completed");

        row.innerHTML = `
            <td>
                <div class="list-task-info">
                    <h4>${escapeHTML(task.title)}</h4>
                    <p>${escapeHTML(task.description || "No description")}</p>
                </div>
            </td>
            <td>
                <span class="status-pill ${task.status}">${statusLabel}</span>
            </td>
            <td>
                <span class="badge-tag priority-${task.priority}">${priorityLabel}</span>
            </td>
            <td>
                <span class="due-text">${task.due_date ? formatDate(task.due_date) : '-'}</span>
            </td>
            <td class="actions-col">
                <div class="list-actions">
                    <button class="action-icon edit" onclick="openTaskModal(${task.id})"><i class="fa-solid fa-pen-to-square"></i></button>
                    <button class="action-icon delete" onclick="deleteTask(${task.id})"><i class="fa-solid fa-trash-can"></i></button>
                </div>
            </td>
        `;
        tbody.appendChild(row);
    });
}

function renderStats() {
    const total = state.tasks.length;
    const todo = state.tasks.filter(t => t.status === "todo").length;
    const inProgress = state.tasks.filter(t => t.status === "in_progress").length;
    const done = state.tasks.filter(t => t.status === "done").length;

    document.getElementById("stat-total").innerText = total;
    document.getElementById("stat-todo").innerText = todo;
    document.getElementById("stat-in-progress").innerText = inProgress;
    document.getElementById("stat-done").innerText = done;
}

// ==========================================================================
// Drag and Drop (Kanban Board Action)
// ==========================================================================
function handleDragStart(e) {
    this.classList.add("dragging");
    e.dataTransfer.setData("text/plain", this.getAttribute("data-id"));
    
    // Highlight drop targets
    document.querySelectorAll(".kanban-column").forEach(col => {
        col.classList.add("drop-active");
    });
}

function handleDragEnd() {
    this.classList.remove("dragging");
    document.querySelectorAll(".kanban-column").forEach(col => {
        col.classList.remove("drop-active", "drag-over");
    });
}

function allowDrop(e) {
    e.preventDefault();
    const col = e.currentTarget;
    if (!col.classList.contains("drag-over")) {
        col.classList.add("drag-over");
    }
}

// Remove dragover classes on column entry/exit
document.querySelectorAll(".kanban-column").forEach(col => {
    col.addEventListener("dragenter", (e) => {
        e.currentTarget.classList.add("drag-over");
    });
    col.addEventListener("dragleave", (e) => {
        e.currentTarget.classList.remove("drag-over");
    });
});

async function handleDrop(e, newStatus) {
    e.preventDefault();
    const taskId = e.dataTransfer.getData("text/plain");
    const task = state.tasks.find(t => t.id == taskId);

    if (!task) return;
    if (task.status === newStatus) return; // Unchanged

    // Optimistic UI Update
    const originalStatus = task.status;
    task.status = newStatus;
    renderTasks();
    renderStats();

    try {
        const response = await fetch(`${API_BASE}/tasks/${taskId}`, {
            method: "PUT",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${state.token}`
            },
            body: JSON.stringify({ status: newStatus })
        });

        if (!response.ok) {
            // Revert state on error
            task.status = originalStatus;
            renderTasks();
            renderStats();
            showToast("Move Error", "Could not sync task status update with server", "error");
        }
    } catch (err) {
        console.error("Error updating task status:", err);
        task.status = originalStatus;
        renderTasks();
        renderStats();
        showToast("Connection Error", "Failed to communicate task drop to backend", "error");
    }
}

// ==========================================================================
// Task Create / Edit Modal Handler
// ==========================================================================
function openTaskModal(taskId = null) {
    const modal = document.getElementById("task-modal");
    const titleInput = document.getElementById("task-title");
    const descInput = document.getElementById("task-description");
    const statusSelect = document.getElementById("task-status");
    const prioritySelect = document.getElementById("task-priority");
    const dueDateInput = document.getElementById("task-due-date");
    const idInput = document.getElementById("task-id-input");
    const submitBtn = document.getElementById("task-submit-btn");
    const modalTitle = document.getElementById("modal-title");

    // Reset Form
    document.getElementById("task-form").reset();
    idInput.value = "";

    if (taskId) {
        // Edit Mode
        const task = state.tasks.find(t => t.id === taskId);
        if (!task) return;

        modalTitle.innerText = "Edit Task";
        idInput.value = task.id;
        titleInput.value = task.title;
        descInput.value = task.description || "";
        statusSelect.value = task.status;
        prioritySelect.value = task.priority;
        dueDateInput.value = task.due_date || "";
        submitBtn.innerText = "Save Changes";
    } else {
        // Create Mode
        modalTitle.innerText = "Create New Task";
        submitBtn.innerText = "Create Task";
    }

    modal.classList.remove("hidden");
}

function closeTaskModal() {
    document.getElementById("task-modal").classList.add("hidden");
}

function handleOutsideModalClick(e) {
    if (e.target.id === "task-modal") {
        closeTaskModal();
    }
}

async function handleTaskSubmit(event) {
    event.preventDefault();
    
    const idInput = document.getElementById("task-id-input").value;
    const title = document.getElementById("task-title").value.trim();
    const description = document.getElementById("task-description").value.trim();
    const status = document.getElementById("task-status").value;
    const priority = document.getElementById("task-priority").value;
    const due_date = document.getElementById("task-due-date").value || null;

    if (!title) return;

    const payload = { title, description, status, priority, due_date };
    const method = idInput ? "PUT" : "POST";
    const url = idInput ? `${API_BASE}/tasks/${idInput}` : `${API_BASE}/tasks`;

    try {
        const response = await fetch(url, {
            method: method,
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${state.token}`
            },
            body: JSON.stringify(payload)
        });

        const data = await response.json();
        if (response.ok) {
            closeTaskModal();
            showToast(
                idInput ? "Task Updated" : "Task Created",
                `"${title}" has been saved.`,
                "success"
            );
            // WebSocket updates will trigger a local reload, but let's load locally to be fast
            loadTasks();
        } else {
            showToast("Saving Failed", data.detail || "Could not save task details", "error");
        }
    } catch (err) {
        console.error("Save error:", err);
        showToast("Network Error", "Could not connect to server to save task", "error");
    }
}

async function deleteTask(taskId) {
    if (!confirm("Are you sure you want to permanently delete this task?")) return;

    try {
        const response = await fetch(`${API_BASE}/tasks/${taskId}`, {
            method: "DELETE",
            headers: { "Authorization": `Bearer ${state.token}` }
        });

        if (response.ok) {
            showToast("Task Deleted", "The task was removed from your space", "success");
            loadTasks();
        } else {
            const data = await response.json();
            showToast("Delete Error", data.detail || "Could not delete task", "error");
        }
    } catch (err) {
        console.error("Delete error:", err);
        showToast("Network Error", "Failed to contact server to delete task", "error");
    }
}

// ==========================================================================
// WebSocket Real-time Sync & Toast Notifications
// ==========================================================================
function connectWebSocket() {
    if (!state.token) return;

    // Reset reconnect timers
    clearTimeout(state.wsReconnectTimeout);

    const statusIndicator = document.getElementById("connection-status");
    const statusText = statusIndicator.querySelector(".status-text");

    try {
        state.ws = new WebSocket(WS_BASE);

        state.ws.onopen = () => {
            statusIndicator.className = "connection-status online";
            statusText.innerText = "Real-time Ready";
            console.log("WebSocket connection established.");
        };

        state.ws.onmessage = (event) => {
            try {
                const message = JSON.parse(event.data);
                handleWebSocketMessage(message);
            } catch (err) {
                console.error("Failed to parse websocket message:", err);
            }
        };

        state.ws.onclose = () => {
            statusIndicator.className = "connection-status offline";
            statusText.innerText = "Offline";
            console.warn("WebSocket disconnected. Retrying in 5 seconds...");
            
            // Reconnect attempt
            state.wsReconnectTimeout = setTimeout(() => {
                connectWebSocket();
            }, 5000);
        };

        state.ws.onerror = (err) => {
            console.error("WebSocket error:", err);
            state.ws.close();
        };

    } catch (err) {
        console.error("WebSocket connection failure:", err);
        statusIndicator.className = "connection-status offline";
        statusText.innerText = "Offline";
    }
}

function handleWebSocketMessage(msg) {
    if (!state.user) return;

    const isDifferentUser = msg.sender !== state.user.username;

    switch (msg.type) {
        case "TASK_CREATED":
            if (isDifferentUser) {
                // If it belongs to this user (we verify by loading again or checking owner_id)
                if (msg.task.owner_id === state.user.id) {
                    loadTasks();
                    showToast("Task Created remotely", `${msg.sender} created "${msg.task.title}"`, "info");
                }
            }
            break;
            
        case "TASK_UPDATED":
            if (isDifferentUser) {
                if (msg.task.owner_id === state.user.id) {
                    loadTasks();
                    showToast("Workspace Synced", `${msg.sender} updated "${msg.task.title}"`, "info");
                }
            }
            break;

        case "TASK_DELETED":
            if (isDifferentUser) {
                // Check if we currently have the task loaded
                const exists = state.tasks.some(t => t.id === msg.task_id);
                if (exists) {
                    loadTasks();
                    showToast("Task Removed", `${msg.sender} deleted a task`, "alert");
                }
            }
            break;
            
        default:
            console.log("Unknown socket action:", msg);
    }
}

function showToast(title, message, type = "info") {
    const container = document.getElementById("toast-container");
    const toast = document.createElement("div");
    
    // Icon mapping
    let iconClass = "fa-solid fa-circle-info";
    if (type === "success") iconClass = "fa-solid fa-circle-check";
    if (type === "alert") iconClass = "fa-solid fa-circle-exclamation";
    if (type === "error") iconClass = "fa-solid fa-circle-xmark";

    toast.className = `toast ${type}`;
    toast.innerHTML = `
        <div class="toast-icon"><i class="${iconClass}"></i></div>
        <div class="toast-body">
            <strong>${escapeHTML(title)}</strong>
            <span>${escapeHTML(message)}</span>
        </div>
        <button class="toast-close" onclick="dismissToast(this)"><i class="fa-solid fa-xmark"></i></button>
    `;

    // Click to dismiss
    toast.addEventListener("click", (e) => {
        if (!e.target.closest(".toast-close")) {
            dismissToast(toast.querySelector(".toast-close"));
        }
    });

    container.appendChild(toast);

    // Auto dismiss after 5 seconds
    setTimeout(() => {
        if (toast.parentNode) {
            dismissToast(toast.querySelector(".toast-close"));
        }
    }, 5000);
}

function dismissToast(closeBtn) {
    if (!closeBtn) return;
    const toast = closeBtn.closest(".toast");
    if (!toast) return;

    toast.classList.add("fade-out");
    toast.addEventListener("animationend", () => {
        toast.remove();
    });
}

// ==========================================================================
// Helper Utility Functions
// ==========================================================================
function escapeHTML(str) {
    if (!str) return "";
    return str.replace(/[&<>'"]/g, 
        tag => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            "'": '&#39;',
            '"': '&quot;'
        }[tag] || tag)
    );
}

function formatDate(dateString) {
    if (!dateString) return "";
    const options = { month: 'short', day: 'numeric', year: 'numeric' };
    const date = new Date(dateString);
    return date.toLocaleDateString(undefined, options);
}

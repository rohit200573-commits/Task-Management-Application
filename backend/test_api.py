import requests
import sys
import time

BASE_URL = "http://127.0.0.1:8000/api"

def test_flow():
    print("Starting integration test flow...")
    
    # 1. Register a test user
    username = f"user_{int(time.time())}"
    password = "password123"
    print(f"Registering user: {username}")
    
    reg_response = requests.post(
        f"{BASE_URL}/auth/register",
        json={"username": username, "password": password}
    )
    
    if reg_response.status_code != 201:
        print(f"Failed to register. Status code: {reg_response.status_code}")
        print(reg_response.text)
        sys.exit(1)
    
    print("Registration successful!")
    
    # 2. Login
    print("Logging in...")
    login_response = requests.post(
        f"{BASE_URL}/auth/login",
        data={"username": username, "password": password}
    )
    
    if login_response.status_code != 200:
        print(f"Login failed. Status code: {login_response.status_code}")
        print(login_response.text)
        sys.exit(1)
        
    token_data = login_response.json()
    token = token_data["access_token"]
    print("Login successful! Token acquired.")
    
    headers = {"Authorization": f"Bearer {token}"}
    
    # 3. Check /auth/me
    print("Fetching current user (/auth/me)...")
    me_response = requests.get(f"{BASE_URL}/auth/me", headers=headers)
    if me_response.status_code != 200 or me_response.json()["username"] != username:
        print("Failed verification on /auth/me")
        sys.exit(1)
    print("Current user matches registered credentials.")
    
    # 4. CRUD Tasks
    print("Creating a test task...")
    task_payload = {
        "title": "Build UI Mockup",
        "description": "Create high-fidelity designs for OrbitTask",
        "status": "todo",
        "priority": "high",
        "due_date": "2026-06-15"
    }
    
    create_res = requests.post(f"{BASE_URL}/tasks", json=task_payload, headers=headers)
    if create_res.status_code != 201:
        print(f"Failed to create task. Code: {create_res.status_code}")
        sys.exit(1)
        
    task = create_res.json()
    task_id = task["id"]
    print(f"Task created successfully. ID: {task_id}")
    
    # 4b. Read task
    print("Reading task lists...")
    list_res = requests.get(f"{BASE_URL}/tasks", headers=headers)
    if list_res.status_code != 200 or len(list_res.json()) != 1:
        print("Failed to read tasks or unexpected task count.")
        sys.exit(1)
    print(f"Loaded {len(list_res.json())} tasks.")
    
    # 4c. Update task
    print("Updating task status and description...")
    update_payload = {
        "status": "in_progress",
        "description": "Updated mockup design requirements"
    }
    
    update_res = requests.put(f"{BASE_URL}/tasks/{task_id}", json=update_payload, headers=headers)
    if update_res.status_code != 200 or update_res.json()["status"] != "in_progress":
        print("Failed to update task status.")
        sys.exit(1)
    print("Task updated successfully on backend.")
    
    # 4d. Delete task
    print("Deleting task...")
    delete_res = requests.delete(f"{BASE_URL}/tasks/{task_id}", headers=headers)
    if delete_res.status_code != 200:
        print("Failed to delete task.")
        sys.exit(1)
    print("Task deleted successfully.")
    
    # Verify it is deleted
    check_list = requests.get(f"{BASE_URL}/tasks", headers=headers).json()
    if len(check_list) != 0:
        print("Delete verification failed. Task list is not empty.")
        sys.exit(1)
        
    print("\n--- ALL TESTS COMPLETED SUCCESSFULLY ---")

if __name__ == "__main__":
    test_flow()

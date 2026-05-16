// ----------------------------
// dashboard.js - Admin Dashboard
// ----------------------------

const loginForm = document.getElementById("loginForm");
const adminLoginBtn = document.getElementById("adminLoginBtn");
const adminEmail = document.getElementById("adminEmail");
const adminPassword = document.getElementById("adminPassword");
const loginMsg = document.getElementById("loginMsg");

const dashboard = document.getElementById("dashboard");
const poemTableBody = document.querySelector("#poemTable tbody");
const logoutBtn = document.getElementById("logoutBtn");

const API_URL = "https://zpda-backend-1.onrender.com";

// ----------------------------
// Check if already logged in
// ----------------------------
if (localStorage.getItem("adminToken")) {
  showDashboard();
}

// ----------------------------
// Admin Login
// ----------------------------
adminLoginBtn.addEventListener("click", async () => {
  const email = adminEmail.value.trim();
  const password = adminPassword.value.trim();
  loginMsg.textContent = "";

  if (!email || !password) {
    loginMsg.textContent = "Please enter email and password.";
    return;
  }

  try {
    const res = await fetch(`${API_URL}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password })
    });
    const data = await res.json();

    if (data.error) {
      loginMsg.textContent = data.error;
      return;
    }

    // Save token in localStorage (for demo, just use user ID as token)
    localStorage.setItem("adminToken", data.user._id);
    showDashboard();

  } catch (err) {
    console.error(err);
    loginMsg.textContent = "Login failed. Try again.";
  }
});

// ----------------------------
// Show Dashboard
// ----------------------------
function showDashboard() {
  loginForm.style.display = "none";
  dashboard.style.display = "block";
  fetchPoems();
}

// ----------------------------
// Fetch Poems
// ----------------------------
async function fetchPoems() {
  try {
    const res = await fetch(`${API_URL}/poems`);
    const poems = await res.json();

    poemTableBody.innerHTML = "";

    poems.forEach(p => {
      const tr = document.createElement("tr");

      tr.innerHTML = `
        <td>${p.title}</td>
        <td>${p.author}</td>
        <td>${p.text.substring(0, 50)}...</td>
        <td>
          <button class="btn btn-edit" onclick="editPoem('${p._id}')">Edit</button>
          <button class="btn btn-delete" onclick="deletePoem('${p._id}')">Delete</button>
        </td>
      `;

      poemTableBody.appendChild(tr);
    });

  } catch (err) {
    console.error("Failed to fetch poems:", err);
  }
}

// ----------------------------
// Delete Poem
// ----------------------------
async function deletePoem(id) {
  if (!confirm("Are you sure you want to delete this poem?")) return;

  try {
    const res = await fetch(`${API_URL}/poems/${id}`, { method: "DELETE" });
    const data = await res.json();
    alert(data.message || "Deleted!");
    fetchPoems();
  } catch (err) {
    console.error(err);
    alert("Failed to delete poem.");
  }
}

// ----------------------------
// Edit Poem (Simple prompt version)
// ----------------------------
async function editPoem(id) {
  const newText = prompt("Enter new poem text:");
  if (!newText) return;

  try {
    const res = await fetch(`${API_URL}/poems/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: newText })
    });
    const data = await res.json();
    alert("Poem updated!");
    fetchPoems();
  } catch (err) {
    console.error(err);
    alert("Failed to update poem.");
  }
}

// ----------------------------
// Logout
// ----------------------------
logoutBtn.addEventListener("click", () => {
  localStorage.removeItem("adminToken");
  dashboard.style.display = "none";
  loginForm.style.display = "block";
});
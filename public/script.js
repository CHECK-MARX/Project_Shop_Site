// Vulnerable Shopping Site JavaScript
// WARNING: This code contains intentional vulnerabilities for educational purposes

let currentUser = null;
let cart = [];
let authToken = null;

// CVE-2023-XXXX: Client-side XSS vulnerability
function displayMessage(message, type = 'info') {
    const alertDiv = document.createElement('div');
    alertDiv.className = `alert alert-${type}`;
    alertDiv.innerHTML = message; // CRITICAL: No output encoding - XSS vulnerability
    document.body.appendChild(alertDiv);
    
    setTimeout(() => {
        alertDiv.remove();
    }, 5000);
}

// CVE-2023-YYYY: Insecure localStorage usage
function saveUserData(user) {
    // CRITICAL: Storing sensitive data in localStorage without encryption
    localStorage.setItem('user', JSON.stringify(user));
    localStorage.setItem('token', user.token);
}

function loadUserData() {
    const userData = localStorage.getItem('user');
    const token = localStorage.getItem('token');
    
    if (userData && token) {
        currentUser = JSON.parse(userData);
        authToken = token;
        updateAuthUI();
    }
}

// CVE-2023-ZZZZ: Weak authentication check
function isAuthenticated() {
    return currentUser !== null && authToken !== null;
}

function isAdmin() {
    return currentUser && currentUser.role === 'admin';
}

function updateAuthUI() {
    const loginBtn = document.getElementById('loginBtn');
    const registerBtn = document.getElementById('registerBtn');
    const logoutBtn = document.getElementById('logoutBtn');
    const adminSection = document.getElementById('adminSection');
    
    if (isAuthenticated()) {
        loginBtn.style.display = 'none';
        registerBtn.style.display = 'none';
        logoutBtn.style.display = 'inline-block';
        
        if (isAdmin()) {
            adminSection.style.display = 'block';
        }
    } else {
        loginBtn.style.display = 'inline-block';
        registerBtn.style.display = 'inline-block';
        logoutBtn.style.display = 'none';
        adminSection.style.display = 'none';
    }
}

// CVE-2023-AAAA: No input validation in API calls
async function makeAPICall(url, options = {}) {
    try {
        const response = await fetch(url, {
            ...options,
            headers: {
                'Content-Type': 'application/json',
                ...(authToken && { 'Authorization': `Bearer ${authToken}` }),
                ...options.headers
            }
        });
        
        const data = await response.json();
        
        if (!response.ok) {
            throw new Error(data.error || 'API call failed');
        }
        
        return data;
    } catch (error) {
        console.error('API Error:', error);
        displayMessage(`エラー: ${error.message}`, 'danger');
        throw error;
    }
}

// Login functionality
async function login(username, password) {
    try {
        const response = await makeAPICall('/api/login', {
            method: 'POST',
            body: JSON.stringify({ username, password })
        });
        
        currentUser = response.user;
        authToken = response.token;
        saveUserData({ ...response.user, token: response.token });
        updateAuthUI();
        
        displayMessage('ログインに成功しました！', 'success');
        closeModal('loginModal');
        loadProducts();
    } catch (error) {
        displayMessage('ログインに失敗しました', 'danger');
    }
}

// Register functionality
async function register(username, email, password) {
    try {
        await makeAPICall('/api/register', {
            method: 'POST',
            body: JSON.stringify({ username, email, password })
        });
        
        displayMessage('登録に成功しました！ログインしてください。', 'success');
        closeModal('registerModal');
    } catch (error) {
        displayMessage('登録に失敗しました', 'danger');
    }
}

// Logout functionality
function logout() {
    currentUser = null;
    authToken = null;
    localStorage.removeItem('user');
    localStorage.removeItem('token');
    cart = [];
    updateAuthUI();
    displayMessage('ログアウトしました', 'info');
    loadProducts();
}

// Load products
async function loadProducts(searchTerm = '') {
    try {
        const url = searchTerm ? `/api/products?search=${encodeURIComponent(searchTerm)}` : '/api/products';
        const products = await makeAPICall(url);
        
        const productsGrid = document.getElementById('productsGrid');
        productsGrid.innerHTML = '';
        
        products.forEach(product => {
            const productCard = createProductCard(product);
            productsGrid.appendChild(productCard);
        });
    } catch (error) {
        console.error('Failed to load products:', error);
    }
}

// CVE-2023-BBBB: XSS in product display
function createProductCard(product) {
    const card = document.createElement('div');
    card.className = 'product-card';
    
    // CRITICAL: No output encoding - XSS vulnerability
    card.innerHTML = `
        <h3>${product.name}</h3>
        <p>${product.description}</p>
        <div class="product-price">¥${product.price}</div>
        <div class="product-stock">在庫: ${product.stock}個</div>
        <button onclick="addToCart(${product.id})" class="btn btn-primary">カートに追加</button>
    `;
    
    return card;
}

// Add to cart
function addToCart(productId) {
    if (!isAuthenticated()) {
        displayMessage('ログインが必要です', 'warning');
        return;
    }
    
    const existingItem = cart.find(item => item.productId === productId);
    if (existingItem) {
        existingItem.quantity += 1;
    } else {
        cart.push({ productId, quantity: 1 });
    }
    
    updateCartDisplay();
    displayMessage('カートに追加しました', 'success');
}

// Update cart display
async function updateCartDisplay() {
    const cartItems = document.getElementById('cartItems');
    const cartTotal = document.getElementById('cartTotal');
    
    if (cart.length === 0) {
        cartItems.innerHTML = '<p>カートは空です</p>';
        cartTotal.textContent = '¥0';
        return;
    }
    
    let total = 0;
    let cartHTML = '';
    
    for (const item of cart) {
        try {
            const product = await makeAPICall(`/api/product/${item.productId}`);
            const itemTotal = product.price * item.quantity;
            total += itemTotal;
            
            // CRITICAL: XSS vulnerability in cart display
            cartHTML += `
                <div class="cart-item">
                    <div>
                        <h4>${product.name}</h4>
                        <p>数量: ${item.quantity}</p>
                    </div>
                    <div>
                        <span class="product-price">¥${itemTotal}</span>
                        <button onclick="removeFromCart(${item.productId})" class="btn btn-danger">削除</button>
                    </div>
                </div>
            `;
        } catch (error) {
            console.error('Failed to load product:', error);
        }
    }
    
    cartItems.innerHTML = cartHTML;
    cartTotal.textContent = `¥${total.toFixed(2)}`;
}

// Remove from cart
function removeFromCart(productId) {
    cart = cart.filter(item => item.productId !== productId);
    updateCartDisplay();
}

// Checkout
async function checkout() {
    if (!isAuthenticated()) {
        displayMessage('ログインが必要です', 'warning');
        return;
    }
    
    if (cart.length === 0) {
        displayMessage('カートが空です', 'warning');
        return;
    }
    
    try {
        for (const item of cart) {
            await makeAPICall('/api/order', {
                method: 'POST',
                body: JSON.stringify({
                    productId: item.productId,
                    quantity: item.quantity,
                    userId: currentUser.id
                })
            });
        }
        
        cart = [];
        updateCartDisplay();
        displayMessage('注文が完了しました！', 'success');
    } catch (error) {
        displayMessage('注文に失敗しました', 'danger');
    }
}

// Admin functions
async function viewUsers() {
    try {
        const users = await makeAPICall('/api/admin/users');
        const adminContent = document.getElementById('adminContent');
        
        // CRITICAL: Exposing sensitive user data including passwords
        let usersHTML = '<h3>ユーザー一覧</h3><table border="1" style="width: 100%; border-collapse: collapse;">';
        usersHTML += '<tr><th>ID</th><th>ユーザー名</th><th>メール</th><th>パスワード</th><th>ロール</th></tr>';
        
        users.forEach(user => {
            usersHTML += `<tr>
                <td>${user.id}</td>
                <td>${user.username}</td>
                <td>${user.email}</td>
                <td>${user.password}</td>
                <td>${user.role}</td>
            </tr>`;
        });
        
        usersHTML += '</table>';
        adminContent.innerHTML = usersHTML;
    } catch (error) {
        displayMessage('ユーザー一覧の取得に失敗しました', 'danger');
    }
}

async function createBackup() {
    const backupName = prompt('バックアップ名を入力してください:');
    if (!backupName) return;
    
    try {
        await makeAPICall('/api/backup', {
            method: 'POST',
            body: JSON.stringify({ backupName })
        });
        displayMessage('バックアップが作成されました', 'success');
    } catch (error) {
        displayMessage('バックアップの作成に失敗しました', 'danger');
    }
}

async function showDebugInfo() {
    try {
        const debugInfo = await makeAPICall('/api/debug');
        const adminContent = document.getElementById('adminContent');
        
        // CRITICAL: Exposing sensitive debug information
        adminContent.innerHTML = `<pre>${JSON.stringify(debugInfo, null, 2)}</pre>`;
    } catch (error) {
        displayMessage('デバッグ情報の取得に失敗しました', 'danger');
    }
}

// Vulnerability testing functions
async function testSQLInjection() {
    const input = document.getElementById('sqlInjectionInput').value;
    if (!input) {
        displayMessage('SQLインジェクションのテスト文字列を入力してください', 'warning');
        return;
    }
    
    try {
        const products = await makeAPICall(`/api/products?search=${encodeURIComponent(input)}`);
        displayMessage(`SQLインジェクションテスト結果: ${products.length}件の商品が見つかりました`, 'info');
    } catch (error) {
        displayMessage('SQLインジェクションテストでエラーが発生しました', 'danger');
    }
}

function testXSS() {
    const input = document.getElementById('xssInput').value;
    if (!input) {
        displayMessage('XSSのテスト文字列を入力してください', 'warning');
        return;
    }
    
    // CRITICAL: Direct XSS execution
    displayMessage(input, 'info');
}

async function testPathTraversal() {
    const input = document.getElementById('pathTraversalInput').value;
    if (!input) {
        displayMessage('パストラバーサルのテスト文字列を入力してください', 'warning');
        return;
    }
    
    try {
        const response = await fetch(`/api/file?filename=${encodeURIComponent(input)}`);
        if (response.ok) {
            displayMessage('パストラバーサルテスト: ファイルが見つかりました', 'danger');
        } else {
            displayMessage('パストラバーサルテスト: ファイルが見つかりませんでした', 'info');
        }
    } catch (error) {
        displayMessage('パストラバーサルテストでエラーが発生しました', 'danger');
    }
}

// Modal functions
function openModal(modalId) {
    document.getElementById(modalId).style.display = 'block';
}

function closeModal(modalId) {
    document.getElementById(modalId).style.display = 'none';
}

// Event listeners
document.addEventListener('DOMContentLoaded', function() {
    loadUserData();
    loadProducts();
    
    // Modal event listeners
    document.getElementById('loginBtn').addEventListener('click', () => openModal('loginModal'));
    document.getElementById('registerBtn').addEventListener('click', () => openModal('registerModal'));
    document.getElementById('logoutBtn').addEventListener('click', logout);
    
    // Close modal on X click
    document.querySelectorAll('.close').forEach(closeBtn => {
        closeBtn.addEventListener('click', (e) => {
            closeModal(e.target.closest('.modal').id);
        });
    });
    
    // Close modal on outside click
    window.addEventListener('click', (e) => {
        if (e.target.classList.contains('modal')) {
            closeModal(e.target.id);
        }
    });
    
    // Form submissions
    document.getElementById('loginForm').addEventListener('submit', (e) => {
        e.preventDefault();
        const username = document.getElementById('loginUsername').value;
        const password = document.getElementById('loginPassword').value;
        login(username, password);
    });
    
    document.getElementById('registerForm').addEventListener('submit', (e) => {
        e.preventDefault();
        const username = document.getElementById('registerUsername').value;
        const email = document.getElementById('registerEmail').value;
        const password = document.getElementById('registerPassword').value;
        register(username, email, password);
    });
    
    // Search functionality
    document.getElementById('searchBtn').addEventListener('click', () => {
        const searchTerm = document.getElementById('searchInput').value;
        loadProducts(searchTerm);
    });
    
    document.getElementById('searchInput').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            const searchTerm = document.getElementById('searchInput').value;
            loadProducts(searchTerm);
        }
    });
    
    // Cart functionality
    document.getElementById('checkoutBtn').addEventListener('click', checkout);
    
    // Admin functionality
    document.getElementById('viewUsersBtn').addEventListener('click', viewUsers);
    document.getElementById('backupBtn').addEventListener('click', createBackup);
    document.getElementById('debugBtn').addEventListener('click', showDebugInfo);
    
    // Vulnerability testing
    document.getElementById('sqlTestBtn').addEventListener('click', testSQLInjection);
    document.getElementById('xssTestBtn').addEventListener('click', testXSS);
    document.getElementById('pathTestBtn').addEventListener('click', testPathTraversal);
    
    // Navigation
    document.querySelectorAll('a[href^="#"]').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const targetId = link.getAttribute('href').substring(1);
            const targetElement = document.getElementById(targetId);
            if (targetElement) {
                targetElement.scrollIntoView({ behavior: 'smooth' });
            }
        });
    });
});

// CVE-2023-CCCC: Global function exposure
window.addToCart = addToCart;
window.removeFromCart = removeFromCart;

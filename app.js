(function () {
  'use strict';

  var STORAGE = 'yt-stationery-demo-v2';
  var AUTO_BACKUP = 'yt-stationery-auto-backup-v2';
  var SUPABASE_URL = 'https://tfvwfpvdqcbgqnijhhpd.supabase.co';
  var SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_1TYSPsIChtMyo_NjcSHQZg_A7uS0PsX';
  var supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
  var passwordRecoveryMode = window.location.hash.indexOf('type=recovery') !== -1;
  var state = loadState();
  var currentUser = null;
  var adminPage = 'dashboard';
  var toastTimer = null;
  var customerCategory = 'All';
  var THEME_STORAGE = 'yt-theme-v2';

  applyTheme(localStorage.getItem(THEME_STORAGE) || 'light');

  function seedState() {
    return {
      products: [
        { id: 1, name: 'Pastel Gel Pen Set', category: 'Writing', price: 6500, stock: 24, photo: '', bg: '#f9e5e9' },
        { id: 2, name: 'A5 Spiral Notebook', category: 'Notebook', price: 4200, stock: 38, photo: '', bg: '#e8f0e1' },
        { id: 3, name: 'Cute Sticker Pack', category: 'Fancy', price: 2800, stock: 18, photo: '', bg: '#fff0cb' },
        { id: 4, name: 'Desk Organizer', category: 'Office', price: 12500, stock: 7, photo: '', bg: '#e5edf8' },
        { id: 5, name: 'Floral Washi Tape', category: 'Fancy', price: 3200, stock: 16, photo: '', bg: '#f5e3f5' },
        { id: 6, name: 'Mini Highlighter Set', category: 'Writing', price: 5500, stock: 22, photo: '', bg: '#fdebd9' },
        { id: 7, name: 'Paper Clip Box', category: 'Office', price: 1800, stock: 35, photo: '', bg: '#e3f2ef' },
        { id: 8, name: 'Gift Wrap Bundle', category: 'Fancy', price: 7500, stock: 9, photo: '', bg: '#f6e5df' }
      ],
      users: [
        { id: 1, username: 'owner', name: 'Yadanar Theingi Owner', role: 'owner', status: 'Active', created: '26 Jul 2026' },
        { id: 2, username: 'mya', name: 'Mya Thiri', role: 'customer', status: 'Active', created: '20 Jul 2026' },
        { id: 3, username: 'aung', name: 'Aung Min', role: 'customer', status: 'Active', created: '22 Jul 2026' }
      ],
      orders: [
        { id: 1008, customerId: 2, customer: 'Mya Thiri', items: [{ productId: 1, quantity: 2, unitPrice: 6500 }, { productId: 3, quantity: 1, unitPrice: 2800 }], total: 15800, status: 'Pending', date: '26 Jul 2026', phone: '09 420 000 111', address: 'Sanchaung Township, Yangon', busStation: '', deliveryDate: '', note: 'Please pack carefully.', adjusted: false },
        { id: 1007, customerId: 3, customer: 'Aung Min', items: [{ productId: 2, quantity: 3, unitPrice: 4200 }], total: 12600, status: 'Ready to Ship', date: '25 Jul 2026', phone: '09 420 000 222', address: 'Pyin Oo Lwin, Mandalay', busStation: 'Pyin Oo Lwin Highway Gate', deliveryDate: '', note: '', adjusted: false },
        { id: 1006, customerId: 2, customer: 'Mya Thiri', items: [{ productId: 4, quantity: 1, unitPrice: 12500 }, { productId: 7, quantity: 4, unitPrice: 1800 }], total: 19700, status: 'Delivered', date: '23 Jul 2026', phone: '09 420 000 111', address: 'Sanchaung Township, Yangon', busStation: '', deliveryDate: '', note: '', adjusted: false }
      ],
      inventory: [
        { id: 1, productId: 1, product: 'Pastel Gel Pen Set', type: 'IN', quantity: 30, date: '24 Jul 2026', note: 'New supplier delivery' },
        { id: 2, productId: 4, product: 'Desk Organizer', type: 'OUT', quantity: 2, date: '25 Jul 2026', note: 'Customer orders' },
        { id: 3, productId: 6, product: 'Mini Highlighter Set', type: 'IN', quantity: 25, date: '25 Jul 2026', note: 'New supplier delivery' }
      ],
      settings: {
        maintenanceMode: false,
        backupFrequency: 'Weekly',
        lastBackup: '',
        voucher: { title: 'Delivery Voucher', footer: 'Thank you for shopping with Yadanar Theingi Stationery & Fancy.', accentColor: '#8c1740' }
      }
    };
  }

  function defaultSettings() {
    return { maintenanceMode: false, backupFrequency: 'Weekly', lastBackup: '', voucher: { title: 'Delivery Voucher', footer: 'Thank you for shopping with Yadanar Theingi Stationery & Fancy.', accentColor: '#8c1740' } };
  }

  function normalize(data) {
    var defaults = defaultSettings();
    data.settings = data.settings || {};
    data.settings.maintenanceMode = Boolean(data.settings.maintenanceMode);
    data.settings.backupFrequency = ['Daily', 'Weekly', 'Monthly'].indexOf(data.settings.backupFrequency) > -1 ? data.settings.backupFrequency : defaults.backupFrequency;
    data.settings.lastBackup = data.settings.lastBackup || '';
    data.settings.voucher = data.settings.voucher || {};
    data.settings.voucher.title = data.settings.voucher.title || defaults.voucher.title;
    data.settings.voucher.footer = data.settings.voucher.footer || defaults.voucher.footer;
    data.settings.voucher.accentColor = data.settings.voucher.accentColor || defaults.voucher.accentColor;
    data.users.forEach(function (user) { delete user.password; });
    data.orders.forEach(function (order) {
      if (order.status === 'Confirmed') order.status = 'Approved';
      if (order.status === 'Preparing') order.status = 'Processing';
      order.items.forEach(function (item) {
        var product = data.products.find(function (entry) { return entry.id === item.productId; });
        if (product && !item.unitPrice) item.unitPrice = product.price;
      });
    });
    return data;
  }

  function loadState() {
    try {
      var saved = JSON.parse(localStorage.getItem(STORAGE));
      if (saved && saved.products && saved.users && saved.orders) {
        var normalized = normalize(saved);
        localStorage.setItem(STORAGE, JSON.stringify(normalized));
        return normalized;
      }
    } catch (error) { }
    var fresh = seedState();
    localStorage.setItem(STORAGE, JSON.stringify(fresh));
    return fresh;
  }

  function autoBackupIfDue() {
    var intervals = { Daily: 1, Weekly: 7, Monthly: 30 };
    var last = Date.parse(state.settings.lastBackup || '');
    if (last && Date.now() - last < intervals[state.settings.backupFrequency] * 86400000) return;
    state.settings.lastBackup = new Date().toISOString();
    localStorage.setItem(AUTO_BACKUP, JSON.stringify({ createdAt: state.settings.lastBackup, data: state }));
  }

  function saveState() {
    autoBackupIfDue();
    localStorage.setItem(STORAGE, JSON.stringify(state));
  }

  function esc(value) {
    return String(value || '').replace(/[&<>"']/g, function (character) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[character];
    });
  }

  function money(value) {
    return Number(value || 0).toLocaleString('en-US') + ' MMK';
  }

  function today() {
    return new Date().toLocaleDateString('en-GB');
  }

  function getProduct(id) {
    return state.products.find(function (product) { return String(product.id) === String(id); });
  }

  function applyTheme(theme) {
    document.body.classList.toggle('dark-mode', theme === 'dark');
    localStorage.setItem(THEME_STORAGE, theme);
  }

  function itemPrice(item) {
    var product = getProduct(item.productId);
    return Number(item.unitPrice || (product ? product.price : 0));
  }

  function lineTotal(item) {
    return item.confirmedPrice !== undefined && item.confirmedPrice !== null ? Number(item.confirmedPrice) : itemPrice(item) * item.quantity;
  }

  function photoMarkup(product, className) {
    var photo = String(product.photo || '');
    var classes = className ? ' class="' + className + '"' : '';
    if (photo.indexOf('data:image/') === 0 || photo.indexOf('https://') === 0) return '<img' + classes + ' src="' + esc(photo) + '" alt="' + esc(product.name) + '">';
    if (className) return '<div' + classes + '><div class="photo-placeholder"><span>Product photo</span><small>Owner will add a photo</small></div></div>';
    return '<div class="photo-placeholder"><span>Product photo</span><small>Owner will add a photo</small></div>';
  }

  function imageToDataUrl(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(String(reader.result)); };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function toast(message) {
    var element = document.getElementById('toast');
    element.textContent = message;
    element.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { element.classList.remove('show'); }, 2800);
  }

  function modal(html) {
    document.getElementById('modal-root').innerHTML = '<div class="modal-backdrop"><div class="modal">' + html + '</div></div>';
    var close = document.getElementById('close-modal');
    if (close) close.addEventListener('click', closeModal);
  }

  function closeModal() {
    var root = document.getElementById('modal-root');
    if (root) root.innerHTML = '';
  }

  function cart() {
    try { return JSON.parse(localStorage.getItem('yt-cart-v2') || '[]'); } catch (error) { return []; }
  }

  function setCart(items) {
    localStorage.setItem('yt-cart-v2', JSON.stringify(items));
  }

  function cartCount() {
    return cart().reduce(function (sum, item) { return sum + item.quantity; }, 0);
  }

  function topbar(hasCart) {
    var customerMenu = currentUser.role === 'customer' ? '<button class="customer-menu-trigger" id="open-customer-menu" aria-label="Open customer menu"><span class="customer-menu-name">' + esc(currentUser.name) + '</span><span class="hamburger"><i></i><i></i><i></i></span></button>' : '<div class="user-label"><b>' + esc(currentUser.name) + '</b><span>Owner account</span></div><button class="logout" id="logout">Log out</button>';
    return '<header class="topbar"><div class="brand-lockup"><div class="monogram">Y</div><span>Yadanar Theingi<br>Stationery & Fancy</span></div><div class="top-actions">' + (hasCart ? '<button class="cart-button" id="open-cart">Cart <span class="cart-count">' + cartCount() + '</span></button>' : '') + customerMenu + '</div></header>';
  }

  function profileToCurrentUser(profile, email) {
    return {
      id: profile.id,
      username: profile.username || email,
      name: profile.full_name || profile.username || email,
      role: profile.role,
      status: profile.is_active ? 'Active' : 'Disabled'
    };
  }

  async function loadAuthenticatedUser(authUser) {
    var result = await supabaseClient
      .from('profiles')
      .select('id, username, full_name, role, is_active')
      .eq('id', authUser.id)
      .single();

    if (result.error || !result.data) throw new Error('Your account profile could not be loaded.');
    if (!result.data.is_active) throw new Error('This account has been disabled.');
    return profileToCurrentUser(result.data, authUser.email || '');
  }

  function mapDatabaseProduct(row) {
    return {
      id: row.id,
      name: row.name,
      category: row.categories ? row.categories.name : 'Uncategorized',
      categoryId: row.category_id,
      price: Number(row.price),
      stock: Number(row.stock_quantity),
      photo: row.image_url || '',
      bg: '#f3e8ec',
      deleted: !row.is_active
    };
  }

  async function loadCatalogueData() {
    var productsResult = await supabaseClient
      .from('products')
      .select('id, name, description, price, stock_quantity, image_url, is_active, category_id, categories(name)')
      .order('created_at', { ascending: true });
    if (productsResult.error) throw productsResult.error;

    var inventoryResult = await supabaseClient
      .from('inventory_movements')
      .select('id, product_id, movement_type, quantity, note, created_at, products(name)')
      .order('created_at', { ascending: false })
      .limit(100);
    if (inventoryResult.error) throw inventoryResult.error;

    state.products = productsResult.data.map(mapDatabaseProduct);
    state.inventory = inventoryResult.data.map(function (row) {
      return {
        id: row.id,
        productId: row.product_id,
        product: row.products ? row.products.name : 'Unknown product',
        type: row.movement_type === 'stock_in' ? 'IN' : (row.movement_type === 'stock_out' ? 'OUT' : 'ADJUST'),
        quantity: row.quantity,
        date: new Date(row.created_at).toLocaleDateString('en-GB'),
        note: row.note || ''
      };
    });
  }

  async function findOrCreateCategory(name) {
    var categoryName = String(name).trim();
    var existing = await supabaseClient.from('categories').select('id, name').ilike('name', categoryName).maybeSingle();
    if (existing.error) throw existing.error;
    if (existing.data) return existing.data;

    var created = await supabaseClient.from('categories').insert({ name: categoryName, is_active: true }).select('id, name').single();
    if (created.error) throw created.error;
    return created.data;
  }

  async function uploadProductImage(productId, file) {
    var extension = String(file.name).split('.').pop().toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
    var path = productId + '/' + Date.now() + '.' + extension;
    var upload = await supabaseClient.storage.from('product-images').upload(path, file, { upsert: false });
    if (upload.error) throw upload.error;
    return supabaseClient.storage.from('product-images').getPublicUrl(path).data.publicUrl;
  }

  async function refreshCataloguePage(message) {
    await loadCatalogueData();
    closeModal();
    renderAdminPage();
    if (message) toast(message);
  }

  function renderLogin() {
    document.getElementById('app').innerHTML = '<section class="login-page"><div class="login-shell"><div class="brand-panel"><div class="brand-lockup"><div class="monogram">Y</div><span>Yadanar Theingi<br>Stationery & Fancy</span></div><h1>Everything lovely for your desk.</h1><p>Order stationery and fancy items easily from your approved customer account.</p><p class="login-note">' + (state.settings.maintenanceMode ? 'Under Maintenance — customer ordering is temporarily unavailable.' : 'Customer accounts are created and managed exclusively by the shop owner.') + '</p></div><form class="login-card" id="login-form"><p class="eyebrow">Secure owner portal</p><h2>Welcome back</h2><p class="subtext">Sign in with the owner email and password registered in Supabase.</p><label class="field">Email<input name="email" type="email" required autocomplete="email"></label><label class="field">Password<input name="password" type="password" required autocomplete="current-password"></label><button class="primary full" type="submit">Sign in</button><button class="text-link full" id="forgot-password" type="button">Forgot password?</button><div class="login-order-note"><b>Note</b><br>Order တင်လိုပါက Viber Number 09780000146 သို့ အရင် ဆက်သွယ်ပေးပါ။</div></form></div></section>';
    document.getElementById('forgot-password').addEventListener('click', renderForgotPassword);
    document.getElementById('login-form').addEventListener('submit', async function (event) {
      event.preventDefault();
      var data = new FormData(event.target);
      var button = event.target.querySelector('button[type="submit"]');
      button.disabled = true;
      button.textContent = 'Signing in…';

      try {
        var authResult = await supabaseClient.auth.signInWithPassword({
          email: String(data.get('email')).trim(),
          password: String(data.get('password'))
        });
        if (authResult.error) throw authResult.error;

        currentUser = await loadAuthenticatedUser(authResult.data.user);
        if (currentUser.role !== 'owner' && currentUser.role !== 'staff') {
          await supabaseClient.auth.signOut();
          currentUser = null;
          throw new Error('Customer login will be enabled in the next setup stage.');
        }
        await loadCatalogueData();
        renderAdmin();
      } catch (error) {
        toast(error.message === 'Invalid login credentials' ? 'Email or password is incorrect.' : error.message);
        button.disabled = false;
        button.textContent = 'Sign in';
      }
    });
  }

  function renderForgotPassword() {
    document.getElementById('app').innerHTML = '<section class="login-page"><form class="login-card" id="forgot-password-form"><p class="eyebrow">Account recovery</p><h2>Reset your password</h2><p class="subtext">Enter the owner email address. We will send a secure password reset link.</p><label class="field">Email<input name="email" type="email" required autocomplete="email"></label><button class="primary full" type="submit">Send recovery email</button><button class="text-link full" id="back-to-login" type="button">Back to sign in</button></form></section>';
    document.getElementById('back-to-login').addEventListener('click', renderLogin);
    document.getElementById('forgot-password-form').addEventListener('submit', async function (event) {
      event.preventDefault();
      var email = String(new FormData(event.target).get('email')).trim();
      var button = event.target.querySelector('button[type="submit"]');
      button.disabled = true;
      button.textContent = 'Sending…';
      var result = await supabaseClient.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin + window.location.pathname
      });
      if (result.error) {
        toast(result.error.message);
        button.disabled = false;
        button.textContent = 'Send recovery email';
        return;
      }
      renderLogin();
      toast('Recovery email sent. Open the newest link in your inbox.');
    });
  }

  function renderPasswordRecovery() {
    passwordRecoveryMode = true;
    document.getElementById('app').innerHTML = '<section class="login-page"><form class="login-card" id="new-password-form"><p class="eyebrow">Secure recovery</p><h2>Choose a new password</h2><p class="subtext">Use at least 12 characters with uppercase, lowercase, a number and a symbol.</p><label class="field">New password<input name="password" type="password" minlength="12" required autocomplete="new-password"></label><label class="field">Confirm password<input name="confirmPassword" type="password" minlength="12" required autocomplete="new-password"></label><button class="primary full" type="submit">Update password</button></form></section>';
    document.getElementById('new-password-form').addEventListener('submit', async function (event) {
      event.preventDefault();
      var data = new FormData(event.target);
      var password = String(data.get('password'));
      if (password !== String(data.get('confirmPassword'))) return toast('The passwords do not match.');
      var button = event.target.querySelector('button[type="submit"]');
      button.disabled = true;
      button.textContent = 'Updating…';
      var result = await supabaseClient.auth.updateUser({ password: password });
      if (result.error) {
        toast(result.error.message);
        button.disabled = false;
        button.textContent = 'Update password';
        return;
      }
      await supabaseClient.auth.signOut();
      passwordRecoveryMode = false;
      window.history.replaceState({}, document.title, window.location.pathname);
      renderLogin();
      toast('Password updated. Sign in with your new password.');
    });
  }

  function renderCustomer() {
    document.getElementById('app').innerHTML = topbar(true) + '<main class="customer-main"><section class="customer-hero"><div><p class="eyebrow">Hello, ' + esc(currentUser.name) + '</p><h1>Order your favourites</h1><p>Choose items, submit your order, and follow the confirmed quantities and shipping status from your customer menu.</p></div><input class="search" id="product-search" placeholder="Search products..."></section><section><div class="section-title"><h2>Our collection</h2><span id="product-count"></span></div><div class="category-filters" id="category-filters"></div><div class="product-grid" id="product-grid"></div></section></main><div id="customer-menu-root"></div><div id="modal-root"></div>';
    document.getElementById('open-cart').addEventListener('click', renderCart);
    document.getElementById('product-search').addEventListener('input', function (event) { renderProducts(event.target.value); });
    document.getElementById('open-customer-menu').addEventListener('click', renderCustomerMenu);
    renderCategoryFilters();
    renderProducts('');
  }

  function renderCategoryFilters() {
    var categories = state.products.filter(function (product) { return !product.deleted; }).map(function (product) { return product.category; }).filter(function (category, index, list) { return list.indexOf(category) === index; }).sort();
    if (categories.indexOf(customerCategory) === -1 && customerCategory !== 'All') customerCategory = 'All';
    document.getElementById('category-filters').innerHTML = ['All'].concat(categories).map(function (category) {
      return '<button class="category-filter ' + (customerCategory === category ? 'active' : '') + '" data-category="' + esc(category) + '">' + esc(category) + '</button>';
    }).join('');
    document.querySelectorAll('[data-category]').forEach(function (button) {
      button.addEventListener('click', function () {
        customerCategory = button.dataset.category;
        renderCategoryFilters();
        renderProducts(document.getElementById('product-search').value);
      });
    });
  }

  function renderProducts(query) {
    var search = String(query || '').toLowerCase();
    var products = state.products.filter(function (product) { return !product.deleted && (customerCategory === 'All' || product.category === customerCategory) && (product.name.toLowerCase().indexOf(search) > -1 || product.category.toLowerCase().indexOf(search) > -1); });
    document.getElementById('product-count').textContent = products.length + ' items available';
    document.getElementById('product-grid').innerHTML = products.length ? products.map(function (product) {
      var hasPhoto = /^(data:image\/|https:\/\/)/.test(String(product.photo || ''));
      var photo = hasPhoto ? '<button class="product-photo photo-preview-button" data-preview-photo="' + product.id + '" aria-label="Preview ' + esc(product.name) + '" style="--product-bg:' + product.bg + '">' + photoMarkup(product) + '</button>' : '<div class="product-photo" style="--product-bg:' + product.bg + '">' + photoMarkup(product) + '</div>';
      return '<article class="product-card">' + photo + '<div class="product-info"><div class="product-category">' + esc(product.category) + '</div><div class="product-name">' + esc(product.name) + '</div><div class="product-meta"><span class="price">' + money(product.price) + '</span><span>' + (product.stock ? product.stock + ' in stock' : 'Out of stock') + '</span></div><div class="card-footer"><input class="qty-input" id="qty-' + product.id + '" type="number" min="1" max="' + product.stock + '" value="1" ' + (product.stock ? '' : 'disabled') + '><button class="primary add-to-cart" data-product="' + product.id + '" ' + (product.stock ? '' : 'disabled') + '>Add</button></div></div></article>';
    }).join('') : '<div class="empty">No matching products found.</div>';
    document.querySelectorAll('[data-product]').forEach(function (button) {
      button.addEventListener('click', function () { addToCart(Number(button.dataset.product), Number(document.getElementById('qty-' + button.dataset.product).value || 1)); });
    });
    document.querySelectorAll('[data-preview-photo]').forEach(function (button) {
      button.addEventListener('click', function () { renderPhotoPreview(Number(button.dataset.previewPhoto)); });
    });
  }

  function renderPhotoPreview(productId) {
    var product = getProduct(productId);
    if (!product || String(product.photo || '').indexOf('data:image/') !== 0) return;
    modal('<div class="modal-head"><div><p class="eyebrow">Product photo</p><h2>' + esc(product.name) + '</h2></div><button class="icon-btn" id="close-modal">×</button></div><div class="photo-lightbox"><img src="' + esc(product.photo) + '" alt="' + esc(product.name) + '"></div>');
  }

  function renderCustomerMenu() {
    var dark = document.body.classList.contains('dark-mode');
    document.getElementById('customer-menu-root').innerHTML = '<div class="customer-menu-backdrop" id="close-customer-menu"></div><aside class="customer-menu-panel"><div class="customer-menu-head"><div><p class="eyebrow">Customer menu</p><h2>' + esc(currentUser.name) + '</h2></div><button class="icon-btn" id="close-customer-menu-button">×</button></div><button class="customer-menu-item" id="open-recent-orders"><span>Recent orders</span><small>Search order ID & view voucher</small></button><label class="theme-switch-row"><span><b>Dark mode</b><small>Change the display theme</small></span><input id="customer-theme-switch" type="checkbox" ' + (dark ? 'checked' : '') + '><span class="theme-switch"></span></label><button class="customer-menu-item danger" id="customer-menu-logout"><span>Log out</span><small>Sign out of this customer account</small></button></aside>';
    document.getElementById('close-customer-menu').addEventListener('click', closeCustomerMenu);
    document.getElementById('close-customer-menu-button').addEventListener('click', closeCustomerMenu);
    document.getElementById('open-recent-orders').addEventListener('click', function () { closeCustomerMenu(); renderRecentOrders(); });
    document.getElementById('customer-theme-switch').addEventListener('change', function (event) { applyTheme(event.target.checked ? 'dark' : 'light'); });
    document.getElementById('customer-menu-logout').addEventListener('click', logout);
  }

  function closeCustomerMenu() {
    var root = document.getElementById('customer-menu-root');
    if (root) root.innerHTML = '';
  }

  function renderRecentOrders() {
    modal('<div class="modal-head"><div><p class="eyebrow">Customer account</p><h2>Recent orders</h2></div><button class="icon-btn" id="close-modal">×</button></div><p class="subtext">Search using your Order ID, for example YT-1008.</p><input class="search order-search" id="recent-order-search" placeholder="Search Order ID..."><div class="table-wrap" id="recent-order-results"></div>');
    document.getElementById('recent-order-search').addEventListener('input', function (event) { renderRecentOrderResults(event.target.value); });
    renderRecentOrderResults('');
  }

  function renderRecentOrderResults(query) {
    var search = String(query || '').toLowerCase().replace('#', '');
    var orders = state.orders.filter(function (order) { return order.customerId === currentUser.id && ('yt-' + order.id).indexOf(search) > -1; }).sort(function (a, b) { return b.id - a.id; });
    document.getElementById('recent-order-results').innerHTML = orders.length ? '<table><thead><tr><th>Order</th><th>Date</th><th>Status</th><th>Action</th></tr></thead><tbody>' + orders.map(function (order) { return '<tr><td class="order-id">#YT-' + order.id + (order.adjusted ? '<br><small>Qty updated by shop</small>' : '') + '</td><td>' + order.date + '</td><td>' + badge(order.status) + '</td><td><div class="action-row"><button class="table-action" data-menu-order-details="' + order.id + '">Details</button>' + (voucherAvailable(order) ? '<button class="table-action" data-menu-order-voucher="' + order.id + '">Voucher</button>' : '') + '</div></td></tr>'; }).join('') + '</tbody></table>' : '<div class="cart-empty">No order matches that Order ID.</div>';
    document.querySelectorAll('[data-menu-order-details]').forEach(function (button) { button.addEventListener('click', function () { renderOrderDetails(Number(button.dataset.menuOrderDetails)); }); });
    document.querySelectorAll('[data-menu-order-voucher]').forEach(function (button) { button.addEventListener('click', function () { renderVoucher(Number(button.dataset.menuOrderVoucher)); }); });
  }

  function addToCart(productId, quantity) {
    var product = getProduct(productId);
    if (!product || !product.stock) return;
    var items = cart();
    var line = items.find(function (item) { return item.productId === productId; });
    if (line) line.quantity = Math.min(product.stock, line.quantity + quantity);
    else items.push({ productId: productId, quantity: Math.min(product.stock, quantity) });
    setCart(items);
    document.querySelector('.cart-count').textContent = cartCount();
    toast(product.name + ' added to cart.');
  }

  function cartLines() {
    return cart().map(function (line) { return { product: getProduct(line.productId), quantity: line.quantity }; }).filter(function (line) { return line.product; });
  }

  function renderCart() {
    var items = cartLines();
    modal('<div class="modal-head"><div><p class="eyebrow">Your order</p><h2>Shopping cart</h2></div><button class="icon-btn" id="close-modal">×</button></div>' + (items.length ? '<div>' + items.map(function (line) { return '<div class="cart-line"><div><b>' + esc(line.product.name) + '</b><span>' + money(line.product.price) + ' each</span></div><input type="number" min="1" max="' + line.product.stock + '" value="' + line.quantity + '" data-cart-quantity="' + line.product.id + '"><div><button class="remove" data-remove-cart="' + line.product.id + '">Remove</button></div></div>'; }).join('') + '</div><button class="primary full" id="checkout">Place order</button>' : '<div class="cart-empty">Your cart is empty.</div>'));
    document.querySelectorAll('[data-cart-quantity]').forEach(function (input) {
      input.addEventListener('change', function () {
        var items = cart();
        var item = items.find(function (entry) { return entry.productId === Number(input.dataset.cartQuantity); });
        var product = getProduct(item.productId);
        item.quantity = Math.max(1, Math.min(product.stock, Number(input.value) || 1));
        setCart(items);
        renderCart();
      });
    });
    document.querySelectorAll('[data-remove-cart]').forEach(function (button) {
      button.addEventListener('click', function () { setCart(cart().filter(function (line) { return line.productId !== Number(button.dataset.removeCart); })); renderCart(); document.querySelector('.cart-count').textContent = cartCount(); });
    });
    var checkout = document.getElementById('checkout');
    if (checkout) checkout.addEventListener('click', renderCheckout);
  }

  function renderCheckout() {
    modal('<form id="checkout-form"><div class="modal-head"><div><p class="eyebrow">Final step</p><h2>Confirm your order</h2></div><button class="icon-btn" type="button" id="close-modal">×</button></div><p class="subtext">No online payment is needed. The shop will review and approve this order.</p><div class="form-grid"><label class="field">Contact phone<input name="phone" required placeholder="09xxxxxxxxx"></label><label class="field">Preferred delivery date<input name="deliveryDate" type="date"></label><label class="field full-field">Delivery address / လိပ်စာ<input name="address" required placeholder="House / Street / Township / City"></label><label class="field full-field">Bus station name / ကားဂိတ်အမည် (optional)<input name="busStation" placeholder="For out-of-town customer orders only"></label><label class="field full-field">Order note (optional)<input name="note"></label></div><div class="two-button"><button class="secondary" type="button" id="back-to-cart">Back</button><button class="primary" type="submit">Submit order</button></div></form>');
    document.getElementById('back-to-cart').addEventListener('click', renderCart);
    document.getElementById('checkout-form').addEventListener('submit', submitOrder);
  }

  function submitOrder(event) {
    event.preventDefault();
    var lines = cartLines();
    if (!lines.length) return;
    if (lines.some(function (line) { return line.quantity > line.product.stock; })) return toast('Stock has changed. Please update the cart.');
    var data = new FormData(event.target);
    var id = Math.max.apply(null, state.orders.map(function (order) { return order.id; })) + 1;
    var total = lines.reduce(function (sum, line) { return sum + line.product.price * line.quantity; }, 0);
    lines.forEach(function (line) {
      line.product.stock -= line.quantity;
      state.inventory.unshift({ id: Date.now() + line.product.id, productId: line.product.id, product: line.product.name, type: 'OUT', quantity: line.quantity, date: today(), note: 'Order #YT-' + id });
    });
    state.orders.unshift({ id: id, customerId: currentUser.id, customer: currentUser.name, items: lines.map(function (line) { return { productId: line.product.id, quantity: line.quantity, unitPrice: line.product.price }; }), total: total, status: 'Pending', date: today(), phone: data.get('phone') || '', address: data.get('address') || '', busStation: data.get('busStation') || '', deliveryDate: data.get('deliveryDate') || '', note: data.get('note') || '', adjusted: false });
    saveState(); setCart([]); closeModal(); renderCustomer(); toast('Order #YT-' + id + ' was submitted successfully.');
  }

  function statusClass(status) {
    return String(status).toLowerCase().replace(/\s+/g, '-');
  }

  function badge(status) {
    return '<span class="badge ' + statusClass(status) + '">' + esc(status) + '</span>';
  }

  function voucherAvailable(order) {
    return order.status === 'Ready to Ship' || order.status === 'Delivered';
  }

  function orderCount(order) {
    return order.items.reduce(function (sum, line) { return sum + line.quantity; }, 0) + ' item(s)';
  }

  function renderCustomerOrders() {
    var orders = state.orders.filter(function (order) { return order.customerId === currentUser.id; }).sort(function (a, b) { return b.id - a.id; });
    document.getElementById('customer-orders').innerHTML = orders.length ? '<table><thead><tr><th>Order</th><th>Date</th><th>Items</th><th>Status</th><th>Action</th></tr></thead><tbody>' + orders.map(function (order) { return '<tr><td class="order-id">#YT-' + order.id + (order.adjusted ? '<br><small>Qty updated by shop</small>' : '') + '</td><td>' + order.date + '</td><td>' + orderCount(order) + '</td><td>' + badge(order.status) + '</td><td><div class="action-row"><button class="table-action" data-view-order="' + order.id + '">Details</button>' + (voucherAvailable(order) ? '<button class="table-action" data-customer-voucher="' + order.id + '">Voucher</button>' : '') + '</div></td></tr>'; }).join('') + '</tbody></table>' : '<div class="cart-empty">You have not placed an order yet.</div>';
    document.querySelectorAll('[data-view-order]').forEach(function (button) { button.addEventListener('click', function () { renderOrderDetails(Number(button.dataset.viewOrder)); }); });
    document.querySelectorAll('[data-customer-voucher]').forEach(function (button) { button.addEventListener('click', function () { renderVoucher(Number(button.dataset.customerVoucher)); }); });
  }

  function renderOrderDetails(orderId) {
    var order = state.orders.find(function (entry) { return entry.id === orderId; });
    if (!order || (currentUser.role !== 'owner' && order.customerId !== currentUser.id)) return;
    var isCustomer = currentUser.role === 'customer';
    var rows = order.items.map(function (item) {
      var product = getProduct(item.productId);
      return product ? '<tr><td>' + esc(product.name) + '</td><td>' + item.quantity + '</td><td>' + money(lineTotal(item)) + '</td></tr>' : '';
    }).join('');
    modal('<div class="modal-head"><div><p class="eyebrow">Order details</p><h2>#YT-' + order.id + '</h2></div><button class="icon-btn" id="close-modal">×</button></div>' + (order.adjusted ? '<div class="order-alert">The shop updated the available quantity. ' + (isCustomer ? 'Your confirmed quantities are shown below.' : 'The total below reflects the confirmed quantities.') + '</div>' : '') + '<p class="subtext"><b>Status:</b> ' + badge(order.status) + (order.note ? '<br><b>Note:</b> ' + esc(order.note) : '') + '</p><div class="table-wrap"><table><thead><tr><th>Item</th><th>Confirmed qty</th><th>' + (isCustomer ? 'Price' : 'Total') + '</th></tr></thead><tbody>' + rows + '</tbody></table></div>' + (isCustomer ? '' : '<div class="cart-total"><span>Order total</span><b>' + money(order.total) + '</b></div>') + (voucherAvailable(order) ? '<div class="two-button"><button class="primary" id="view-voucher">View / print voucher</button></div>' : ''));
    var viewVoucher = document.getElementById('view-voucher');
    if (viewVoucher) viewVoucher.addEventListener('click', function () { renderVoucher(order.id); });
  }

  function renderAdmin() {
    document.getElementById('app').innerHTML = topbar(false) + '<div class="admin-layout"><aside class="sidebar"><div class="admin-brand">Yadanar Theingi<span>Owner dashboard</span></div><button class="nav-button" data-page="dashboard">Dashboard</button><button class="nav-button" data-page="orders">Orders</button><button class="nav-button" data-page="products">Products</button><button class="nav-button" data-page="inventory">Inventory</button><button class="nav-button" data-page="customers">Customers</button><button class="nav-button" data-page="owners">Owner accounts</button><button class="nav-button" data-page="settings">Settings</button></aside><main class="admin-content" id="admin-content"></main></div><div id="modal-root"></div>';
    document.getElementById('logout').addEventListener('click', logout);
    document.querySelectorAll('[data-page]').forEach(function (button) { button.addEventListener('click', function () { adminPage = button.dataset.page; renderAdminPage(); }); });
    renderAdminPage();
  }

  function renderAdminPage() {
    document.querySelectorAll('[data-page]').forEach(function (button) { button.classList.toggle('active', button.dataset.page === adminPage); });
    var content = document.getElementById('admin-content');
    var pages = { dashboard: dashboardPage, orders: ordersPage, products: productsPage, inventory: inventoryPage, customers: customersPage, owners: ownersPage, settings: settingsPage };
    content.innerHTML = pages[adminPage]();
    bindAdmin();
  }

  function dashboardPage() {
    var pending = state.orders.filter(function (order) { return order.status === 'Pending'; }).length;
    var revenue = state.orders.filter(function (order) { return order.status === 'Delivered'; }).reduce(function (sum, order) { return sum + order.total; }, 0);
    var customers = state.users.filter(function (user) { return user.role === 'customer' && user.status === 'Active'; }).length;
    var low = state.products.filter(function (product) { return product.stock < 10; }).length;
    return '<div class="page-heading"><div><p class="eyebrow">Overview</p><h1>Good morning, Owner</h1><p>Review new orders and keep stock ready for shipping.</p></div><button class="primary" data-go="orders">View orders</button></div><section class="dashboard-stats">' + stat('New orders', pending, pending ? 'Needs your review' : 'All caught up') + stat('Delivered revenue', money(revenue), 'Delivered orders') + stat('Active customers', customers, 'Owner-managed accounts') + stat('Low stock items', low, low ? 'Restock soon' : 'Stock levels are good') + '</section><section class="admin-grid"><div class="panel"><h2 class="panel-title">Recent orders <button class="text-link" data-go="orders">View all</button></h2>' + adminOrderTable(state.orders.slice().sort(function (a, b) { return b.id - a.id; }).slice(0, 5), false) + '</div><div class="panel"><h2 class="panel-title">Low stock</h2>' + stockList(state.products.filter(function (product) { return product.stock < 10; })) + '</div></section>';
  }

  function stat(label, value, note) {
    return '<article class="stat-card"><div class="stat-label">' + label + '</div><div class="stat-value">' + value + '</div><div class="stat-change">' + note + '</div></article>';
  }

  function ordersPage() {
    return '<div class="page-heading"><div><p class="eyebrow">Order management</p><h1>Orders</h1><p>Adjust confirmed quantities, move orders through delivery, and upload proof of delivery.</p></div></div><div class="panel owner-search-panel"><input class="search" id="owner-order-search" placeholder="Search Order ID or customer name..."></div><div class="panel table-wrap" id="owner-order-results">' + adminOrderTable(state.orders.slice().sort(function (a, b) { return b.id - a.id; }), true) + '</div>';
  }

  function adminOrderTable(orders, editable) {
    if (!orders.length) return '<div class="cart-empty">No orders yet.</div>';
    var statuses = ['Pending', 'Approved', 'Processing', 'Ready to Ship', 'Delivered'];
    return '<table><thead><tr><th>Order</th><th>Customer</th><th>Items</th><th>Total</th><th>Status</th>' + (editable ? '<th>Action</th>' : '') + '</tr></thead><tbody>' + orders.map(function (order) {
      var control = editable ? '<select class="status-select" data-status="' + order.id + '">' + statuses.map(function (status) { return '<option value="' + status + '" ' + (order.status === status ? 'selected' : '') + '>' + status + '</option>'; }).join('') + '</select>' : badge(order.status);
      return '<tr><td><span class="order-id">#YT-' + order.id + '</span><br><small>' + order.date + '</small></td><td><b>' + esc(order.customer) + '</b><br><small>' + esc(order.phone || 'No phone') + '</small></td><td>' + orderCount(order) + (order.adjusted ? '<br><small>Adjusted</small>' : '') + '</td><td>' + money(order.total) + '</td><td>' + control + '</td>' + (editable ? '<td><div class="action-row"><button class="table-action" data-owner-order-view="' + order.id + '">View</button><button class="table-action" data-owner-voucher="' + order.id + '">Voucher</button></div></td>' : '') + '</tr>';
    }).join('') + '</tbody></table>';
  }

  function matchingOwnerOrders(query) {
    var term = String(query || '').trim().toLowerCase();
    var idTerm = term.replace(/\D/g, '');
    return state.orders.slice().sort(function (a, b) { return b.id - a.id; }).filter(function (order) {
      return !term || String(order.customer || '').toLowerCase().indexOf(term) !== -1 || (idTerm && String(order.id).indexOf(idTerm) !== -1) || ('yt-' + order.id).indexOf(term.replace('#', '')) !== -1;
    });
  }

  function bindOrderTableActions(scope) {
    var root = scope || document;
    root.querySelectorAll('[data-status]').forEach(function (select) { select.addEventListener('change', function () { updateStatus(Number(select.dataset.status), select.value); }); });
    root.querySelectorAll('[data-owner-order-view]').forEach(function (button) { button.addEventListener('click', function () { renderOwnerOrderModal(Number(button.dataset.ownerOrderView), 'view'); }); });
    root.querySelectorAll('[data-owner-voucher]').forEach(function (button) { button.addEventListener('click', function () { renderVoucher(Number(button.dataset.ownerVoucher)); }); });
  }

  function productsPage() {
    var products = state.products.filter(function (product) { return !product.deleted; });
    return '<div class="page-heading"><div><p class="eyebrow">Catalogue</p><h1>Products</h1><p>Upload product photos and change prices for an entire category.</p></div><div class="action-row"><button class="secondary" id="adjust-category">Adjust category prices</button><button class="primary" id="new-product">+ Add product</button></div></div><div class="panel table-wrap"><table><thead><tr><th>Product</th><th>Category</th><th>Price</th><th>Stock</th><th>Action</th></tr></thead><tbody>' + products.map(function (product) { return '<tr><td><div class="product-cell">' + photoMarkup(product, 'table-photo') + '<b>' + esc(product.name) + '</b></div></td><td>' + esc(product.category) + '</td><td>' + money(product.price) + '</td><td><b class="' + (product.stock < 10 ? 'low' : '') + '">' + product.stock + '</b></td><td><div class="action-row"><button class="table-action" data-edit-product="' + product.id + '">Edit</button><button class="table-action" data-manual-stock="' + product.id + '">Adjust stock</button><button class="table-action delete-action" data-delete-product="' + product.id + '">Delete</button></div></td></tr>'; }).join('') + '</tbody></table></div>';
  }

  function inventoryPage() {
    return '<div class="page-heading"><div><p class="eyebrow">Stock control</p><h1>Inventory in / out</h1><p>Record supplier deliveries, stock changes and customer order movements.</p></div><button class="primary" id="new-stock">+ Record stock movement</button></div><section class="admin-grid"><div class="panel table-wrap"><h2 class="panel-title">Recent movements</h2><table><thead><tr><th>Date</th><th>Product</th><th>Type</th><th>Qty</th><th>Note</th></tr></thead><tbody>' + state.inventory.slice().sort(function (a, b) { return b.id - a.id; }).slice(0, 20).map(function (move) { return '<tr><td>' + move.date + '</td><td><b>' + esc(move.product) + '</b></td><td><span class="badge ' + (move.type === 'IN' ? 'approved' : 'pending') + '">' + move.type + '</span></td><td>' + move.quantity + '</td><td>' + esc(move.note) + '</td></tr>'; }).join('') + '</tbody></table></div><div class="panel"><h2 class="panel-title">Current stock</h2>' + stockList(state.products.slice().sort(function (a, b) { return a.stock - b.stock; })) + '</div></section>';
  }

  function stockList(products) {
    return products.length ? products.map(function (product) { return '<div class="stock-row"><div><b>' + esc(product.name) + '</b><small>' + esc(product.category) + '</small></div><b class="' + (product.stock < 10 ? 'low' : '') + '">' + product.stock + ' left</b></div>'; }).join('') : '<div class="cart-empty">All products are above the low-stock threshold.</div>';
  }

  function customersPage() {
    var customers = state.users.filter(function (user) { return user.role === 'customer'; });
    return '<div class="page-heading"><div><p class="eyebrow">Access control</p><h1>Customer accounts</h1><p>Create ordering accounts and choose who can access the customer portal.</p></div><button class="primary" id="new-customer">+ Create customer account</button></div><div class="panel table-wrap"><table><thead><tr><th>Customer</th><th>Username</th><th>Orders</th><th>Access</th><th>Action</th></tr></thead><tbody>' + customers.map(function (customer) { return '<tr><td><b>' + esc(customer.name) + '</b></td><td>' + esc(customer.username) + '</td><td>' + state.orders.filter(function (order) { return order.customerId === customer.id; }).length + '</td><td>' + badge(customer.status) + '</td><td><button class="table-action" data-toggle-customer="' + customer.id + '">' + (customer.status === 'Active' ? 'Disable' : 'Enable') + '</button></td></tr>'; }).join('') + '</tbody></table></div>';
  }

  function ownersPage() {
    var owners = state.users.filter(function (user) { return user.role === 'owner'; });
    return '<div class="page-heading"><div><p class="eyebrow">Access control</p><h1>Owner accounts</h1><p>Create additional owner accounts for trusted staff who manage the whole system.</p></div><button class="primary" id="new-owner">+ Create owner account</button></div><div class="panel table-wrap"><table><thead><tr><th>Owner</th><th>Username</th><th>Created</th><th>Access</th></tr></thead><tbody>' + owners.map(function (owner) { return '<tr><td><b>' + esc(owner.name) + '</b></td><td>' + esc(owner.username) + '</td><td>' + owner.created + '</td><td>' + badge(owner.status) + '</td></tr>'; }).join('') + '</tbody></table></div>';
  }

  function settingsPage() {
    var s = state.settings;
    var choices = ['Daily', 'Weekly', 'Monthly'].map(function (choice) { return '<option value="' + choice + '" ' + (s.backupFrequency === choice ? 'selected' : '') + '>' + choice + '</option>'; }).join('');
    var preview = voucherPreview(s.voucher);
    return '<div class="page-heading"><div><p class="eyebrow">Shop controls</p><h1>Settings</h1><p>Configure maintenance, backups, and your customer voucher style.</p></div></div><section class="admin-grid"><form class="panel" id="site-settings"><h2 class="panel-title">Site maintenance</h2><p class="subtext">Customers cannot log in while Under Maintenance is enabled. Owner accounts can always access settings.</p><label class="field"><span><input name="maintenance" type="checkbox" ' + (s.maintenanceMode ? 'checked' : '') + '> Enable Under Maintenance</span></label><label class="field">Automatic backup frequency<select name="backupFrequency">' + choices + '</select></label><div class="two-button"><button class="primary" type="submit">Save site settings</button></div></form><div class="panel"><h2 class="panel-title">Backup & restore</h2><p class="subtext"><b>Last local snapshot:</b><br>' + esc(s.lastBackup ? new Date(s.lastBackup).toLocaleString() : 'Not created yet') + '</p><p class="photo-help">This demo records its automatic backup whenever an owner uses the site after the chosen frequency is due. The live server version runs backups automatically even when nobody is logged in.</p><button class="primary" type="button" id="download-backup">Download backup</button><label class="field" style="margin-top:18px">Restore a backup file<input id="restore-backup" type="file" accept="application/json"></label></div></section><section class="panel voucher-settings"><form id="voucher-settings"><div class="page-heading"><div><p class="eyebrow">Voucher design</p><h1>Customize & preview</h1><p>Customers can view and print this voucher at Ready to Ship.</p></div><button class="primary" type="submit">Save voucher style</button></div><div class="form-grid"><label class="field full-field">Voucher title<input name="title" id="voucher-title" value="' + esc(s.voucher.title) + '"></label><label class="field">Accent colour<input name="color" id="voucher-color" type="color" value="' + esc(s.voucher.accentColor) + '"></label><label class="field full-field">Footer message<input name="footer" id="voucher-footer" value="' + esc(s.voucher.footer) + '"></label></div></form><div id="voucher-preview">' + preview + '</div></section>';
  }

  function bindAdmin() {
    document.querySelectorAll('[data-go]').forEach(function (button) { button.addEventListener('click', function () { adminPage = button.dataset.go; renderAdminPage(); }); });
    bindOrderTableActions(document);
    document.querySelectorAll('[data-edit-product]').forEach(function (button) { button.addEventListener('click', function () { renderProductForm(button.dataset.editProduct); }); });
    document.querySelectorAll('[data-manual-stock]').forEach(function (button) { button.addEventListener('click', function () { renderManualStockAdjust(button.dataset.manualStock); }); });
    document.querySelectorAll('[data-delete-product]').forEach(function (button) { button.addEventListener('click', function () { renderProductDelete(button.dataset.deleteProduct); }); });
    document.querySelectorAll('[data-toggle-customer]').forEach(function (button) { button.addEventListener('click', function () { var user = state.users.find(function (entry) { return entry.id === Number(button.dataset.toggleCustomer); }); user.status = user.status === 'Active' ? 'Disabled' : 'Active'; saveState(); renderAdminPage(); toast('Customer access updated.'); }); });
    var newProduct = document.getElementById('new-product'); if (newProduct) newProduct.addEventListener('click', function () { renderProductForm(); });
    var adjustCategory = document.getElementById('adjust-category'); if (adjustCategory) adjustCategory.addEventListener('click', renderCategoryAdjust);
    var newStock = document.getElementById('new-stock'); if (newStock) newStock.addEventListener('click', renderStockForm);
    var newCustomer = document.getElementById('new-customer'); if (newCustomer) newCustomer.addEventListener('click', function () { renderAccountForm('customer'); });
    var newOwner = document.getElementById('new-owner'); if (newOwner) newOwner.addEventListener('click', function () { renderAccountForm('owner'); });
    var siteSettings = document.getElementById('site-settings'); if (siteSettings) siteSettings.addEventListener('submit', saveSiteSettings);
    var voucherSettings = document.getElementById('voucher-settings'); if (voucherSettings) voucherSettings.addEventListener('submit', saveVoucherSettings);
    var download = document.getElementById('download-backup'); if (download) download.addEventListener('click', downloadBackup);
    var restore = document.getElementById('restore-backup'); if (restore) restore.addEventListener('change', restoreBackup);
    var ownerOrderSearch = document.getElementById('owner-order-search');
    if (ownerOrderSearch) ownerOrderSearch.addEventListener('input', function () {
      var results = document.getElementById('owner-order-results');
      results.innerHTML = adminOrderTable(matchingOwnerOrders(ownerOrderSearch.value), true);
      bindOrderTableActions(results);
    });
    ['voucher-title', 'voucher-color', 'voucher-footer'].forEach(function (id) { var input = document.getElementById(id); if (input) input.addEventListener('input', renderLiveVoucherPreview); });
  }

  function updateStatus(orderId, status) {
    var order = state.orders.find(function (entry) { return entry.id === orderId; });
    if (!order) return;
    if (status === 'Delivered' && !order.proofOfDelivery) return renderProofForm(orderId);
    order.status = status;
    saveState(); renderAdminPage(); toast('Order #YT-' + orderId + ' updated to ' + status + '.');
  }

  function renderOwnerOrderModal(orderId, activeTab) {
    var order = state.orders.find(function (entry) { return entry.id === orderId; });
    if (!order) return;
    var showChecklist = activeTab === 'checklist';
    var showAdjust = activeTab === 'adjust';
    var tabs = '<div class="order-tabs"><button class="order-tab ' + (!showChecklist ? 'active' : '') + '" type="button" data-owner-order-tab="view">View</button><button class="order-tab ' + (showChecklist ? 'active' : '') + '" type="button" data-owner-order-tab="checklist">Check list</button></div>';
    var details = '<div class="order-view-summary"><div><span>Customer</span><b>' + esc(order.customer) + '</b><small>' + esc(order.phone || 'Phone not recorded') + '</small></div><div><span>Delivery</span><b>' + esc(order.address || 'Address not recorded') + '</b>' + (order.busStation ? '<small>Bus station: ' + esc(order.busStation) + '</small>' : '') + '</div><div><span>Status</span>' + badge(order.status) + '<small>Order date: ' + order.date + '</small></div></div>';
    var rows = order.items.map(function (item) {
      var product = getProduct(item.productId);
      if (!product) return '';
      if (!showChecklist) return '<tr><td><b>' + esc(product.name) + '</b></td><td>' + item.quantity + '</td><td>' + money(lineTotal(item)) + '</td><td><span class="pick-mark ' + (item.picked ? '' : 'pick-pending') + '">' + (item.picked ? 'Picked' : 'Not checked') + '</span></td></tr>';
      return '<tr><td><b>' + esc(product.name) + '</b><br><small>Unit price: ' + money(itemPrice(item)) + '</small></td><td><input class="qty-input" name="qty-' + product.id + '" data-checklist-qty="' + product.id + '" data-unit-price="' + itemPrice(item) + '" type="number" min="1" max="' + (product.stock + item.quantity) + '" value="' + item.quantity + '"><br><small>Available: ' + (product.stock + item.quantity) + '</small></td><td><input class="qty-input checklist-price-input" name="price-' + product.id + '" data-checklist-price="' + product.id + '" data-manual-price="' + (item.confirmedPrice !== undefined && item.confirmedPrice !== null ? 'true' : '') + '" type="number" min="0" step="1" value="' + lineTotal(item) + '"></td><td><label class="check-item"><input name="picked-' + product.id + '" type="checkbox" ' + (item.picked ? 'checked' : '') + '> Picked</label></td></tr>';
    }).join('');
    if (showAdjust) {
      var adjustRows = order.items.map(function (item) {
        var product = getProduct(item.productId);
        if (!product) return '';
        var quantityControl = item.picked
          ? '<b>' + item.quantity + '</b><br><small>Picked — locked</small>'
          : '<input class="qty-input" name="qty-' + product.id + '" type="number" min="1" max="' + (product.stock + item.quantity) + '" value="' + item.quantity + '"><br><small>Available: ' + (product.stock + item.quantity) + '</small>';
        return '<tr><td><b>' + esc(product.name) + '</b></td><td>' + quantityControl + '</td><td>' + money(itemPrice(item)) + '</td><td>' + money(lineTotal(item)) + '</td></tr>';
      }).join('');
      modal('<form id="owner-adjust-form"><div class="modal-head"><div><p class="eyebrow">Order #YT-' + order.id + '</p><h2>Adjust quantity</h2></div><button class="icon-btn" id="close-modal" type="button">×</button></div>' + tabs + '<p class="subtext">Save the quantity first. After an item is marked Picked in the Check list, its quantity and confirmed price are locked.</p><div class="table-wrap"><table><thead><tr><th>Item</th><th>Confirmed qty</th><th>Unit price</th><th>Current price</th></tr></thead><tbody>' + adjustRows + '</tbody></table></div><div class="two-button"><button class="primary" type="submit">Save quantity</button></div></form>');
      document.querySelectorAll('[data-owner-order-tab]').forEach(function (button) { button.addEventListener('click', function () { renderOwnerOrderModal(order.id, button.dataset.ownerOrderTab); }); });
      document.getElementById('owner-adjust-form').addEventListener('submit', function (event) {
        event.preventDefault();
        var data = new FormData(event.target);
        var changes = [];
        for (var index = 0; index < order.items.length; index += 1) {
          var item = order.items[index];
          var product = getProduct(item.productId);
          var quantity = item.picked ? item.quantity : Number(data.get('qty-' + item.productId));
          if (!item.picked && (!Number.isInteger(quantity) || quantity < 1 || quantity > product.stock + item.quantity)) return toast('Enter a valid available quantity for every unpicked product.');
          changes.push({ item: item, product: product, quantity: quantity, difference: quantity - item.quantity });
        }
        changes.forEach(function (change) {
          change.product.stock -= change.difference;
          change.item.quantity = change.quantity;
          if (change.difference !== 0) state.inventory.unshift({ id: Date.now() + change.product.id, productId: change.product.id, product: change.product.name, type: change.difference > 0 ? 'OUT' : 'IN', quantity: Math.abs(change.difference), date: today(), note: 'Order #YT-' + order.id + ' quantity adjustment' });
        });
        order.total = order.items.reduce(function (sum, item) { return sum + itemPrice(item) * item.quantity; }, 0);
        order.adjusted = order.adjusted || changes.some(function (change) { return change.difference !== 0; });
        saveState(); renderOwnerOrderModal(order.id, 'view'); toast('Confirmed quantity and price updated.');
      });
      return;
    }
    var content = !showChecklist
      ? '<div class="modal-head"><div><p class="eyebrow">Order #YT-' + order.id + '</p><h2>Order view</h2></div><button class="icon-btn" id="close-modal" type="button">×</button></div>' + tabs + details + (order.adjusted ? '<div class="order-alert">The confirmed quantity was updated. The customer can see the revised item quantities.</div>' : '') + '<div class="table-wrap"><table><thead><tr><th>Item</th><th>Qty</th><th>Total</th><th>Pick list</th></tr></thead><tbody>' + rows + '</tbody></table></div><div class="cart-total"><span>Order total</span><b>' + money(order.total) + '</b></div>'
      : '<form id="owner-checklist-form"><div class="modal-head"><div><p class="eyebrow">Order #YT-' + order.id + '</p><h2>Check list</h2></div><button class="icon-btn" id="close-modal" type="button">×</button></div>' + tabs + '<p class="subtext">Adjust the quantity and tick Picked in the same list. Saving records that item\'s current quantity and price as its confirmed order value.</p>' + details + '<div class="table-wrap"><table><thead><tr><th>Item</th><th>Confirmed qty</th><th>Confirmed price</th><th>Picked</th></tr></thead><tbody>' + rows + '</tbody></table></div><div class="two-button"><button class="primary" type="submit">Save check list</button></div></form>';
    modal(content);
    document.querySelectorAll('[data-owner-order-tab]').forEach(function (button) { button.addEventListener('click', function () { renderOwnerOrderModal(order.id, button.dataset.ownerOrderTab); }); });
    var form = document.getElementById('owner-checklist-form');
    if (!form) return;
    document.querySelectorAll('[data-checklist-qty]').forEach(function (input) {
      input.addEventListener('input', function () {
        var price = document.querySelector('[data-checklist-price="' + input.dataset.checklistQty + '"]');
        if (price && price.dataset.manualPrice !== 'true') price.value = Number(input.dataset.unitPrice) * (Number(input.value) || 0);
      });
    });
    document.querySelectorAll('[data-checklist-price]').forEach(function (input) { input.addEventListener('input', function () { input.dataset.manualPrice = 'true'; }); });
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      var data = new FormData(event.target);
      var changes = [];
      for (var index = 0; index < order.items.length; index += 1) {
        var item = order.items[index];
        var product = getProduct(item.productId);
        var quantity = Number(data.get('qty-' + item.productId));
        var confirmedPrice = Number(data.get('price-' + item.productId));
        if (!Number.isInteger(quantity) || quantity < 1 || quantity > product.stock + item.quantity) return toast('Enter a valid available quantity for every product.');
        if (!Number.isInteger(confirmedPrice) || confirmedPrice < 0) return toast('Enter a valid confirmed price for every product.');
        changes.push({ item: item, product: product, quantity: quantity, difference: quantity - item.quantity, price: confirmedPrice, priceChanged: confirmedPrice !== lineTotal(item) });
      }
      changes.forEach(function (change) {
        change.product.stock -= change.difference;
        change.item.quantity = change.quantity;
        change.item.confirmedPrice = change.price;
        change.item.picked = data.get('picked-' + change.product.id) === 'on';
        if (change.difference !== 0) state.inventory.unshift({ id: Date.now() + change.product.id, productId: change.product.id, product: change.product.name, type: change.difference > 0 ? 'OUT' : 'IN', quantity: Math.abs(change.difference), date: today(), note: 'Order #YT-' + order.id + ' check list quantity adjustment' });
      });
      order.total = order.items.reduce(function (sum, item) { return sum + lineTotal(item); }, 0);
      order.adjusted = order.adjusted || changes.some(function (change) { return change.difference !== 0 || change.priceChanged; });
      saveState(); renderOwnerOrderModal(order.id, 'view'); toast('Check list quantities, prices and picked items saved.');
    });
  }

  function renderAdjustOrder(orderId) {
    var order = state.orders.find(function (entry) { return entry.id === orderId; });
    if (!order) return;
    if (voucherAvailable(order)) return toast('Quantities cannot be changed after an order is ready to ship.');
    var rows = order.items.map(function (item) {
      var product = getProduct(item.productId);
      return product ? '<tr><td><b>' + esc(product.name) + '</b><br><small>Available including this order: ' + (product.stock + item.quantity) + '</small></td><td><input class="qty-input" name="qty-' + product.id + '" type="number" min="1" max="' + (product.stock + item.quantity) + '" value="' + item.quantity + '"></td></tr>' : '';
    }).join('');
    modal('<form id="adjust-order-form"><div class="modal-head"><div><p class="eyebrow">Order #YT-' + order.id + '</p><h2>Adjust confirmed quantity</h2></div><button class="icon-btn" id="close-modal" type="button">×</button></div><p class="subtext">If an item is short, enter the quantity you can provide. The customer sees the new quantity and price in their order details.</p><div class="table-wrap"><table><thead><tr><th>Product</th><th>Confirmed qty</th></tr></thead><tbody>' + rows + '</tbody></table></div><div class="two-button"><button class="primary" type="submit">Save quantity changes</button></div></form>');
    document.getElementById('adjust-order-form').addEventListener('submit', function (event) {
      event.preventDefault();
      var data = new FormData(event.target);
      var changes = [];
      for (var index = 0; index < order.items.length; index += 1) {
        var item = order.items[index];
        var product = getProduct(item.productId);
        var quantity = Number(data.get('qty-' + item.productId));
        if (!Number.isInteger(quantity) || quantity < 1 || quantity > product.stock + item.quantity) return toast('Enter a valid available quantity for every product.');
        changes.push({ item: item, product: product, quantity: quantity, difference: quantity - item.quantity });
      }
      changes.forEach(function (change) {
        change.product.stock -= change.difference;
        change.item.quantity = change.quantity;
        if (change.difference !== 0) state.inventory.unshift({ id: Date.now() + change.product.id, productId: change.product.id, product: change.product.name, type: change.difference > 0 ? 'OUT' : 'IN', quantity: Math.abs(change.difference), date: today(), note: 'Order #YT-' + order.id + ' quantity adjustment' });
      });
      order.total = order.items.reduce(function (sum, item) { return sum + itemPrice(item) * item.quantity; }, 0);
      order.adjusted = true;
      saveState(); closeModal(); renderAdminPage(); toast('Confirmed quantities and customer total updated.');
    });
  }

  function renderProofForm(orderId) {
    var order = state.orders.find(function (entry) { return entry.id === orderId; });
    modal('<form id="proof-form"><div class="modal-head"><div><p class="eyebrow">Order #YT-' + order.id + '</p><h2>Proof of delivery</h2></div><button class="icon-btn" id="close-modal" type="button">×</button></div><p class="subtext">A delivery photo is optional. You can mark this order as Delivered with or without a photo.</p><label class="field">Proof photo (optional)<input id="proof-photo" type="file" accept="image/*"></label><p class="photo-help">For this demo, keep the photo below 1.5 MB.</p><div class="photo-upload-preview" id="proof-preview"><div class="photo-placeholder"><span>Proof photo</span><small>Add a photo only if needed</small></div></div><div class="two-button"><button class="primary" type="submit">Mark Delivered</button></div></form>');
    document.getElementById('proof-photo').addEventListener('change', function (event) {
      var file = event.target.files[0];
      if (!file) return;
      if (file.size > 1500000) { event.target.value = ''; return toast('Choose a proof photo smaller than 1.5 MB for this demo.'); }
      imageToDataUrl(file).then(function (src) { document.getElementById('proof-preview').innerHTML = '<img src="' + esc(src) + '" alt="Proof preview">'; });
    });
    document.getElementById('proof-form').addEventListener('submit', async function (event) {
      event.preventDefault();
      var file = document.getElementById('proof-photo').files[0];
      if (file) {
        try { order.proofOfDelivery = await imageToDataUrl(file); } catch (error) { return toast('The proof photo could not be saved.'); }
      }
      order.status = 'Delivered'; order.deliveredAt = new Date().toLocaleString();
      saveState(); closeModal(); renderAdminPage(); toast(file ? 'Proof saved and order marked Delivered.' : 'Order marked Delivered without a proof photo.');
    });
  }

  function renderProductForm(productId) {
    var product = productId ? getProduct(productId) : null;
    modal('<form id="product-form"><div class="modal-head"><div><p class="eyebrow">Catalogue</p><h2>' + (product ? 'Edit product' : 'Add product') + '</h2></div><button class="icon-btn" id="close-modal" type="button">×</button></div><div class="form-grid"><label class="field full-field">Product name<input name="name" required value="' + (product ? esc(product.name) : '') + '"></label><label class="field">Category<input name="category" required value="' + (product ? esc(product.category) : '') + '"></label><label class="field">Price (MMK)<input name="price" type="number" min="0" required value="' + (product ? product.price : '') + '"></label><label class="field">Current stock<input name="stock" type="number" min="0" step="1" required value="' + (product ? product.stock : '') + '"></label><label class="field full-field">Product photo<input id="product-photo" type="file" accept="image/jpeg,image/png,image/webp"></label><p class="photo-help full-field">JPEG, PNG or WebP. Maximum file size: 500 KB.</p><div class="photo-upload-preview full-field" id="product-preview">' + photoMarkup(product || { name: 'New product', photo: '' }) + '</div></div><div class="two-button"><button class="primary" type="submit">Save product</button></div></form>');
    document.getElementById('product-photo').addEventListener('change', function (event) {
      var file = event.target.files[0];
      if (!file) return;
      if (file.size > 500000) { event.target.value = ''; return toast('Choose a product photo smaller than 500 KB.'); }
      imageToDataUrl(file).then(function (src) { document.getElementById('product-preview').innerHTML = '<img src="' + esc(src) + '" alt="Product preview">'; });
    });
    document.getElementById('product-form').addEventListener('submit', async function (event) {
      event.preventDefault();
      var data = new FormData(event.target);
      var price = Number(data.get('price'));
      var stock = Number(data.get('stock'));
      if (!Number.isFinite(price) || price < 0) return toast('Enter a valid product price.');
      if (!Number.isInteger(stock) || stock < 0) return toast('Enter a whole stock quantity of 0 or more.');
      var productIdValue = product ? product.id : crypto.randomUUID();
      var photo = product ? product.photo : '';
      var file = document.getElementById('product-photo').files[0];
      var submitButton = event.target.querySelector('button[type="submit"]');
      submitButton.disabled = true;
      submitButton.textContent = 'Saving…';
      try {
        var category = await findOrCreateCategory(data.get('category'));
        if (file) photo = await uploadProductImage(productIdValue, file);
        var values = { id: productIdValue, name: String(data.get('name')).trim(), category_id: category.id, price: price, stock_quantity: stock, image_url: photo || null, is_active: true };
        var result = product
          ? await supabaseClient.from('products').update(values).eq('id', product.id)
          : await supabaseClient.from('products').insert(values);
        if (result.error) throw result.error;
        await refreshCataloguePage('Product saved to the database.');
      } catch (error) {
        toast(error.message || 'The product could not be saved.');
        submitButton.disabled = false;
        submitButton.textContent = 'Save product';
      }
    });
  }

  function renderManualStockAdjust(productId) {
    var product = getProduct(productId);
    if (!product || product.deleted) return;
    modal('<form id="manual-stock-form"><div class="modal-head"><div><p class="eyebrow">Manual stock adjustment</p><h2>' + esc(product.name) + '</h2></div><button class="icon-btn" id="close-modal" type="button">×</button></div><p class="subtext">Set the exact current stock quantity. The system will automatically add an IN or OUT inventory record for the difference.</p><div class="form-grid"><label class="field">Current stock<input value="' + product.stock + '" disabled></label><label class="field">New stock quantity<input name="newStock" type="number" min="0" step="1" required value="' + product.stock + '"></label><label class="field full-field">Adjustment note<input name="note" placeholder="Stock count, damaged items, correction..."></label></div><div class="two-button"><button class="primary" type="submit">Save stock adjustment</button></div></form>');
    document.getElementById('manual-stock-form').addEventListener('submit', async function (event) {
      event.preventDefault();
      var data = new FormData(event.target);
      var newStock = Number(data.get('newStock'));
      if (!Number.isInteger(newStock) || newStock < 0) return toast('Enter a whole stock quantity of 0 or more.');
      var difference = newStock - product.stock;
      try {
        var update = await supabaseClient.from('products').update({ stock_quantity: newStock }).eq('id', product.id);
        if (update.error) throw update.error;
        if (difference !== 0) {
          var movement = await supabaseClient.from('inventory_movements').insert({
            product_id: product.id,
            movement_type: 'adjustment',
            quantity: Math.abs(difference),
            previous_stock: product.stock,
            resulting_stock: newStock,
            note: data.get('note') || 'Manual stock adjustment',
            created_by: currentUser.id
          });
          if (movement.error) throw movement.error;
        }
        await refreshCataloguePage('Stock updated to ' + newStock + '.');
      } catch (error) { toast(error.message || 'Stock could not be updated.'); }
    });
  }

  function renderProductDelete(productId) {
    var product = getProduct(productId);
    if (!product || product.deleted) return;
    modal('<form id="delete-product-form"><div class="modal-head"><div><p class="eyebrow">Delete product</p><h2>' + esc(product.name) + '</h2></div><button class="icon-btn" id="close-modal" type="button">×</button></div><p class="subtext">This removes the product from the customer catalogue and Owner Products list. Existing order and inventory history will be kept safely.</p><div class="two-button"><button class="secondary" id="cancel-delete" type="button">Cancel</button><button class="primary" type="submit">Delete product</button></div></form>');
    document.getElementById('cancel-delete').addEventListener('click', closeModal);
    document.getElementById('delete-product-form').addEventListener('submit', async function (event) {
      event.preventDefault();
      var result = await supabaseClient.from('products').update({ is_active: false }).eq('id', product.id);
      if (result.error) return toast(result.error.message);
      await refreshCataloguePage(product.name + ' was removed from the sales catalogue.');
    });
  }

  function renderCategoryAdjust() {
    var categories = state.products.filter(function (product) { return !product.deleted; }).map(function (product) { return product.category; }).filter(function (value, index, list) { return list.indexOf(value) === index; }).sort();
    modal('<form id="category-form"><div class="modal-head"><div><p class="eyebrow">Pricing tool</p><h2>Adjust category prices</h2></div><button class="icon-btn" id="close-modal" type="button">×</button></div><p class="subtext">Increase or reduce every product in one category at the same time.</p><label class="field">Category<select name="category">' + categories.map(function (category) { return '<option value="' + esc(category) + '">' + esc(category) + '</option>'; }).join('') + '</select></label><label class="field">Percentage change<input name="percentage" type="number" min="-100" step="0.01" required placeholder="Example: 10 or -5"></label><p class="photo-help">10 increases by 10%. -5 reduces by 5%. Prices are rounded to the nearest 50 MMK.</p><div class="two-button"><button class="primary" type="submit">Apply price change</button></div></form>');
    document.getElementById('category-form').addEventListener('submit', async function (event) {
      event.preventDefault();
      var data = new FormData(event.target);
      var percentage = Number(data.get('percentage'));
      if (!Number.isFinite(percentage)) return toast('Enter a valid percentage.');
      var changed = state.products.filter(function (product) { return !product.deleted && product.category === data.get('category'); });
      try {
        await Promise.all(changed.map(function (product) {
          var newPrice = Math.max(0, Math.round(product.price * (1 + percentage / 100) / 50) * 50);
          return supabaseClient.from('products').update({ price: newPrice }).eq('id', product.id).then(function (result) { if (result.error) throw result.error; });
        }));
        await refreshCataloguePage(changed.length + ' product price(s) updated.');
      } catch (error) { toast(error.message || 'Category prices could not be updated.'); }
    });
  }

  function renderStockForm() {
    modal('<form id="stock-form"><div class="modal-head"><div><p class="eyebrow">Inventory</p><h2>Record stock movement</h2></div><button class="icon-btn" id="close-modal" type="button">×</button></div><label class="field">Product<select name="productId">' + state.products.filter(function (product) { return !product.deleted; }).map(function (product) { return '<option value="' + product.id + '">' + esc(product.name) + ' (' + product.stock + ' in stock)</option>'; }).join('') + '</select></label><div class="form-grid"><label class="field">Movement<select name="type"><option value="IN">Stock in</option><option value="OUT">Stock out</option></select></label><label class="field">Quantity<input name="quantity" type="number" min="1" value="1"></label><label class="field full-field">Note<input name="note"></label></div><div class="two-button"><button class="primary" type="submit">Record movement</button></div></form>');
    document.getElementById('stock-form').addEventListener('submit', async function (event) {
      event.preventDefault();
      var data = new FormData(event.target);
      var product = getProduct(data.get('productId'));
      var quantity = Number(data.get('quantity'));
      if (!Number.isInteger(quantity) || quantity < 1) return toast('Enter a whole quantity of 1 or more.');
      if (data.get('type') === 'OUT' && quantity > product.stock) return toast('Stock out quantity exceeds current stock.');
      var resultingStock = product.stock + (data.get('type') === 'IN' ? quantity : -quantity);
      try {
        var update = await supabaseClient.from('products').update({ stock_quantity: resultingStock }).eq('id', product.id);
        if (update.error) throw update.error;
        var movement = await supabaseClient.from('inventory_movements').insert({
          product_id: product.id,
          movement_type: data.get('type') === 'IN' ? 'stock_in' : 'stock_out',
          quantity: quantity,
          previous_stock: product.stock,
          resulting_stock: resultingStock,
          note: data.get('note') || 'Manual adjustment',
          created_by: currentUser.id
        });
        if (movement.error) throw movement.error;
        await refreshCataloguePage('Inventory movement recorded.');
      } catch (error) { toast(error.message || 'Inventory movement could not be saved.'); }
    });
  }

  function renderAccountForm(role) {
    var label = role === 'owner' ? 'Owner' : 'Customer';
    modal('<div><div class="modal-head"><div><p class="eyebrow">Secure access control</p><h2>' + label + ' account setup</h2></div><button class="icon-btn" id="close-modal" type="button">×</button></div><p class="subtext">Account creation is temporarily unavailable while secure username accounts are moved to Supabase. No password will be stored in this browser.</p><div class="two-button"><button class="primary" id="close-account-notice" type="button">Close</button></div></div>');
    document.getElementById('close-account-notice').addEventListener('click', closeModal);
  }

  function saveSiteSettings(event) {
    event.preventDefault();
    var data = new FormData(event.target);
    state.settings.maintenanceMode = data.get('maintenance') === 'on';
    state.settings.backupFrequency = data.get('backupFrequency');
    saveState(); renderAdminPage(); toast('Site settings saved.');
  }

  function voucherPreview(voucher) {
    return '<section class="voucher voucher-preview" style="--voucher-accent:' + esc(voucher.accentColor) + '"><div class="voucher-top"><div><div class="voucher-brand">Yadanar Theingi</div><div class="voucher-shop">Stationery & Fancy</div></div><div class="voucher-order"><b>' + esc(voucher.title) + '</b><span>#YT-1008</span></div></div><div class="voucher-details"><div><span>Customer</span><b>Customer name</b><small>09xxxxxxxxx</small></div><div><span>Status</span>' + badge('Ready to Ship') + '<small>Order date</small></div></div><div class="voucher-address"><span>Delivery address</span><b>Customer delivery address will appear here</b><small>Bus station: Optional for out-of-town orders</small></div><div class="voucher-preview-lines"><span>Product items and confirmed quantities</span><b>Total: 00,000 MMK</b></div><p class="voucher-footer">' + esc(voucher.footer) + '</p></section>';
  }

  function renderLiveVoucherPreview() {
    var preview = document.getElementById('voucher-preview');
    preview.innerHTML = voucherPreview({ title: document.getElementById('voucher-title').value, accentColor: document.getElementById('voucher-color').value, footer: document.getElementById('voucher-footer').value });
  }

  function saveVoucherSettings(event) {
    event.preventDefault();
    var data = new FormData(event.target);
    state.settings.voucher = { title: data.get('title'), accentColor: data.get('color'), footer: data.get('footer') };
    saveState(); toast('Voucher style saved.');
  }

  function downloadBackup() {
    var payload = JSON.stringify({ app: 'Yadanar Theingi Ordering System', exportedAt: new Date().toISOString(), data: state }, null, 2);
    var blob = new Blob([payload], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url; link.download = 'yadanar-theingi-backup-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    toast('Backup download started.');
  }

  function restoreBackup(event) {
    var file = event.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var parsed = JSON.parse(String(reader.result));
        var restored = parsed.data || parsed;
        if (!restored.products || !restored.users || !restored.orders) throw new Error('invalid');
        localStorage.setItem(AUTO_BACKUP, JSON.stringify({ createdAt: new Date().toISOString(), data: state }));
        state = normalize(restored);
        localStorage.setItem(STORAGE, JSON.stringify(state));
        if (currentUser) renderAdmin(); else renderLogin();
        toast('Backup restored successfully.');
      } catch (error) {
        toast('That backup file is not valid.');
      }
    };
    reader.readAsText(file);
  }

  function applyVoucherPrintSize(size) {
    var paper = size === 'a5' ? 'a5' : 'a4';
    var voucher = document.querySelector('.voucher');
    if (voucher) {
      voucher.classList.toggle('print-a5', paper === 'a5');
      voucher.classList.toggle('print-a4', paper === 'a4');
    }
    var style = document.getElementById('voucher-print-paper-style');
    if (!style) {
      style = document.createElement('style');
      style.id = 'voucher-print-paper-style';
      document.head.appendChild(style);
    }
    style.textContent = '@media print { @page { size: ' + (paper === 'a5' ? 'A5' : 'A4') + ' portrait; margin: ' + (paper === 'a5' ? '7mm' : '10mm') + '; } }';
    localStorage.setItem('yadanar-voucher-paper-size', paper);
  }

  function renderVoucher(orderId) {
    var order = state.orders.find(function (entry) { return entry.id === orderId; });
    if (!order || (currentUser.role !== 'owner' && currentUser.id !== order.customerId)) return;
    var voucher = state.settings.voucher;
    var isCustomer = currentUser.role === 'customer';
    var rows = order.items.map(function (item) {
      var product = getProduct(item.productId);
      return product ? '<tr><td>' + esc(product.name) + '</td><td>' + item.quantity + '</td><td>' + money(lineTotal(item)) + '</td></tr>' : '';
    }).join('');
    modal('<div class="modal-head no-print"><div><p class="eyebrow">Order voucher</p><h2>#YT-' + order.id + '</h2></div><button class="icon-btn" id="close-modal">×</button></div><section class="voucher" style="--voucher-accent:' + esc(voucher.accentColor) + '"><div class="voucher-top"><div><div class="voucher-brand">Yadanar Theingi</div><div class="voucher-shop">Stationery & Fancy</div></div><div class="voucher-order"><b>' + esc(voucher.title) + '</b><span>#YT-' + order.id + '</span></div></div><div class="voucher-details"><div><span>Customer</span><b>' + esc(order.customer) + '</b><small>' + esc(order.phone || 'Phone not recorded') + '</small></div><div><span>Status</span>' + badge(order.status) + '<small>' + order.date + '</small></div></div><div class="voucher-address"><span>Delivery address</span><b>' + esc(order.address || 'Address not recorded') + '</b>' + (order.busStation ? '<small>Bus station: ' + esc(order.busStation) + '</small>' : '') + '</div><div class="table-wrap"><table><thead><tr><th>Item</th><th>Qty</th><th>Total</th></tr></thead><tbody>' + rows + '</tbody></table></div><div class="cart-total"><span>Order total</span><b>' + money(order.total) + '</b></div>' + (order.proofOfDelivery ? '<div class="voucher-proof"><span>Proof of delivery</span><img src="' + esc(order.proofOfDelivery) + '" alt="Proof of delivery"></div>' : '') + '<p class="voucher-footer">' + esc(voucher.footer) + '</p></section><div class="two-button no-print"><button class="primary" id="print-voucher">Print voucher</button></div>');
    if (isCustomer) {
      var headers = document.querySelectorAll('.voucher table thead th');
      if (headers[2]) headers[2].textContent = 'Price';
      var voucherTotal = document.querySelector('.voucher .cart-total');
      if (voucherTotal) voucherTotal.remove();
    }
    var savedPaper = localStorage.getItem('yadanar-voucher-paper-size') || 'a4';
    var printButton = document.getElementById('print-voucher');
    printButton.insertAdjacentHTML('beforebegin', '<label class="voucher-print-size">Print size<select id="voucher-paper-size"><option value="a4" ' + (savedPaper === 'a4' ? 'selected' : '') + '>A4</option><option value="a5" ' + (savedPaper === 'a5' ? 'selected' : '') + '>A5</option></select></label>');
    var paperSize = document.getElementById('voucher-paper-size');
    applyVoucherPrintSize(savedPaper);
    paperSize.addEventListener('change', function () { applyVoucherPrintSize(paperSize.value); });
    printButton.addEventListener('click', function () { applyVoucherPrintSize(paperSize.value); window.print(); });
  }

  async function logout() {
    await supabaseClient.auth.signOut();
    currentUser = null;
    adminPage = 'dashboard';
    renderLogin();
  }

  async function startApp() {
    document.getElementById('app').innerHTML = '<section class="login-page"><div class="login-card"><h2>Loading…</h2><p class="subtext">Checking your secure session.</p></div></section>';
    try {
      var sessionResult = await supabaseClient.auth.getSession();
      var session = sessionResult.data.session;
      if (passwordRecoveryMode && session) return renderPasswordRecovery();
      if (!session) return renderLogin();

      currentUser = await loadAuthenticatedUser(session.user);
      if (currentUser.role === 'owner' || currentUser.role === 'staff') {
        await loadCatalogueData();
        return renderAdmin();
      }
      await supabaseClient.auth.signOut();
      currentUser = null;
      renderLogin();
    } catch (error) {
      await supabaseClient.auth.signOut();
      currentUser = null;
      renderLogin();
      toast(error.message || 'Unable to restore your session.');
    }
  }

  supabaseClient.auth.onAuthStateChange(function (event) {
    if (event === 'PASSWORD_RECOVERY') renderPasswordRecovery();
  });

  startApp();
}());

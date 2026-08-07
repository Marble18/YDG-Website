(function () {
  'use strict';

  var LEGACY_DEMO_STORAGE = 'yt-stationery-demo-v2';
  var LEGACY_DEMO_BACKUP = 'yt-stationery-auto-backup-v2';
  var LEGACY_DEMO_CART = 'yt-cart-v2';
  var STORAGE = 'yt-stationery-state-v3';
  var AUTO_BACKUP = 'yt-stationery-auto-backup-v3';
  var CART_STORAGE = 'yt-cart-v3';
  var SUPABASE_URL = 'https://tfvwfpvdqcbgqnijhhpd.supabase.co';
  var SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_1TYSPsIChtMyo_NjcSHQZg_A7uS0PsX';
  var supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
  var accountService = window.createAccountService(supabaseClient);
  var productCatalogueService = window.createProductCatalogueService(supabaseClient);
  var orderService = window.createOrderService(supabaseClient);
  var passwordRecoveryMode = window.location.hash.indexOf('type=recovery') !== -1;
  var state = loadState();
  var currentUser = null;
  var adminPage = 'dashboard';
  var toastTimer = null;
  var customerCategory = 'All';
  var PAGE_SIZE = 20;
  var customerCatalogue = { items: [], total: 0, search: '', categoryId: '', loading: false, error: '', requestId: 0 };
  var ownerCatalogue = { items: [], total: 0, search: '', categoryId: '', visibility: 'all', loading: false, error: '', requestId: 0 };
  var dashboardLowStock = { items: [], total: 0, loading: false, error: '' };
  var remoteCart = [];
  var checkoutKey = null;
  var THEME_STORAGE = 'yt-theme-v2';

  applyTheme(localStorage.getItem(THEME_STORAGE) || 'light');

  function seedState(settings) {
    return { products: [], users: [], orders: [], inventory: [], settings: settings || defaultSettings() };
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
    data.categories = data.categories || [];
    data.products.forEach(function (product) {
      product.unit = product.unit === 'box' ? 'box' : 'pcs';
      product.minimumOrderQuantity = Number.isInteger(product.minimumOrderQuantity) && product.minimumOrderQuantity > 0 ? product.minimumOrderQuantity : 1;
    });
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
    var preservedSettings = null;
    try {
      var legacy = JSON.parse(localStorage.getItem(LEGACY_DEMO_STORAGE));
      if (legacy && legacy.settings) preservedSettings = legacy.settings;
    } catch (error) { }
    localStorage.removeItem(LEGACY_DEMO_STORAGE);
    localStorage.removeItem(LEGACY_DEMO_BACKUP);
    localStorage.removeItem(LEGACY_DEMO_CART);
    try {
      var saved = JSON.parse(localStorage.getItem(STORAGE));
      if (saved && saved.products && saved.users && saved.orders) {
        var normalized = normalize(saved);
        localStorage.setItem(STORAGE, JSON.stringify(normalized));
        return normalized;
      }
    } catch (error) { }
    var fresh = normalize(seedState(preservedSettings || defaultSettings()));
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

  function mergeProductCache(products) {
    products.forEach(function (product) {
      var index = state.products.findIndex(function (entry) { return String(entry.id) === String(product.id); });
      if (index === -1) state.products.push(product);
      else state.products[index] = product;
    });
  }

  function debounce(callback, wait) {
    var timer;
    return function () {
      var args = arguments;
      clearTimeout(timer);
      timer = setTimeout(function () { callback.apply(null, args); }, wait);
    };
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
    if (photo.indexOf('data:image/') === 0 || photo.indexOf('https://') === 0) return '<img' + classes + ' src="' + esc(photo) + '" alt="' + esc(product.name) + '" loading="lazy" decoding="async">';
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
    var root = document.getElementById('modal-root');
    var previousFocus = document.activeElement;
    root.innerHTML = '<div class="modal-backdrop"><div class="modal" role="dialog" aria-modal="true">' + html + '</div></div>';
    var close = document.getElementById('close-modal');
    if (close) close.addEventListener('click', closeModal);
    root._previousFocus = previousFocus;
    root.querySelector('.modal-backdrop').addEventListener('click', function (event) { if (event.target.classList.contains('modal-backdrop')) closeModal(); });
    root._escapeHandler = function (event) {
      if (event.key === 'Escape') return closeModal();
      if (event.key !== 'Tab') return;
      var focusable = Array.from(root.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'));
      if (!focusable.length) return;
      var first = focusable[0], last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', root._escapeHandler);
    if (close) close.focus();
  }

  function closeModal() {
    var root = document.getElementById('modal-root');
    if (root) {
      if (root._escapeHandler) document.removeEventListener('keydown', root._escapeHandler);
      var previousFocus = root._previousFocus;
      root.innerHTML = '';
      if (previousFocus && previousFocus.focus) previousFocus.focus();
    }
  }

  function cart() {
    return remoteCart.slice();
  }

  function cartCount() {
    return cart().reduce(function (sum, item) { return sum + item.quantity; }, 0);
  }

  async function loadRemoteCart() {
    var rows = await orderService.listCart();
    remoteCart = rows.filter(function (row) { return row.products && row.products.is_active; }).map(function (row) {
      var product = mapDatabaseProduct(Object.assign({}, row.products, { categories: null, category_id: null, stock_quantity: 0 }));
      mergeProductCache([product]);
      return { productId: row.product_id, quantity: Number(row.quantity) };
    });
  }

  async function migrateLegacyCartOnce() {
    var raw = localStorage.getItem(CART_STORAGE);
    if (!raw) return loadRemoteCart();
    var legacy;
    try { legacy = JSON.parse(raw); } catch (error) { legacy = []; }
    if (Array.isArray(legacy)) {
      var ids = legacy.map(function (item) { return item && item.productId; }).filter(Boolean);
      var products = ids.length ? (await productCatalogueService.getByIds(ids)).map(mapDatabaseProduct) : [];
      for (var index = 0; index < legacy.length; index += 1) {
        var item = legacy[index];
        var product = products.find(function (entry) { return String(entry.id) === String(item && item.productId); });
        var quantity = Number(item && item.quantity);
        if (product && !product.deleted && Number.isInteger(quantity) && quantity >= product.minimumOrderQuantity) {
          await orderService.setCartItem(product.id, quantity);
        }
      }
    }
    localStorage.removeItem(CART_STORAGE);
    await loadRemoteCart();
  }

  function mapDatabaseOrder(row) {
    return {
      id: row.id, orderNumber: row.order_number, customerId: row.customer_id,
      customer: row.profiles ? (row.profiles.full_name || row.profiles.username) : 'Customer',
      items: (row.order_items || []).map(function (item) { return {
        id: item.id, productId: item.product_id, productName: item.product_name, unit: item.unit,
        unitPrice: Number(item.unit_price), quantity: Number(item.quantity), lineTotal: Number(item.line_total),
        confirmedQuantity: Number(item.confirmed_quantity), confirmedUnitPrice: Number(item.confirmed_unit_price),
        confirmedLineTotal: Number(item.confirmed_line_total), allocatedQuantity: Number(item.allocated_quantity),
        confirmedPrice: Number(item.confirmed_line_total), picked: Boolean(item.picked)
      }; }),
      total: Number(row.total), confirmedTotal: Number(row.confirmed_total), status: String(row.status || 'pending').replace(/_/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); }),
      date: new Date(row.created_at).toLocaleDateString('en-GB'), phone: row.contact_phone || '', address: row.delivery_address || '',
      busStation: row.bus_station || '', deliveryDate: row.preferred_delivery_date || '', note: row.customer_note || '',
      proofOfDelivery: row.delivery_proof_url || '',
      adjusted: (row.order_items || []).some(function (item) { return Number(item.confirmed_quantity) !== Number(item.quantity); })
    };
  }

  async function loadRemoteOrders() {
    state.orders = (await orderService.listOrders()).map(mapDatabaseOrder);
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

  async function loadManagedAccounts() {
    var response = await accountService.list();
    state.users = response.accounts.map(function (account) {
      return {
        id: account.id,
        username: account.username,
        name: account.fullName,
        role: account.role,
        status: account.isActive ? 'Active' : 'Disabled',
        created: new Date(account.createdAt).toLocaleDateString('en-GB')
      };
    });
  }

  function mapDatabaseProduct(row) {
    return {
      id: row.id,
      name: row.name,
      category: row.categories ? row.categories.name : 'Uncategorized',
      categoryId: row.category_id,
      price: Number(row.price),
      stock: Number(row.stock_quantity),
      unit: row.unit === 'box' ? 'box' : 'pcs',
      minimumOrderQuantity: Number(row.minimum_order_quantity) || 1,
      photo: row.image_url || '',
      bg: '#f3e8ec',
      deleted: !row.is_active
    };
  }

  async function loadCatalogueData() {
    var categoriesQuery = supabaseClient
      .from('categories')
      .select('id, name, is_active')
      .order('name', { ascending: true });
    if (currentUser && currentUser.role === 'customer') categoriesQuery = categoriesQuery.eq('is_active', true);
    var categoriesResult = await categoriesQuery;
    if (categoriesResult.error) throw categoriesResult.error;

    var inventoryResult = await supabaseClient
      .from('inventory_movements')
      .select('id, product_id, movement_type, quantity, note, created_at, products(name)')
      .order('created_at', { ascending: false })
      .limit(100);
    if (inventoryResult.error) throw inventoryResult.error;

    state.products = [];
    state.categories = categoriesResult.data;
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
    if (!categoryName) throw new Error('Category is required.');
    var existing = state.categories.find(function (category) { return category.name.toLowerCase() === categoryName.toLowerCase(); });
    if (existing) return existing;

    var created = await supabaseClient.from('categories').insert({ name: categoryName, is_active: true }).select('id, name').single();
    if (created.error && created.error.code === '23505') {
      var retry = await supabaseClient.from('categories').select('id, name, is_active');
      var match = retry.data && retry.data.find(function (category) { return category.name.toLowerCase() === categoryName.toLowerCase(); });
      if (retry.error || !match) throw created.error;
      if (!match.is_active) {
        var reactivated = await supabaseClient.from('categories').update({ is_active: true }).eq('id', match.id).select('id, name').single();
        if (reactivated.error) throw reactivated.error;
        match = reactivated.data;
      }
      state.categories.push(match);
      return match;
    }
    if (created.error) throw created.error;
    state.categories.push(created.data);
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
    document.getElementById('app').innerHTML = '<section class="login-page"><div class="login-shell"><div class="brand-panel"><div class="brand-lockup"><div class="monogram">Y</div><span>Yadanar Theingi<br>Stationery & Fancy</span></div><h1>Everything lovely for your desk.</h1><p>Order stationery and fancy items easily from your approved customer account.</p><p class="login-note">' + (state.settings.maintenanceMode ? 'Under Maintenance — customer ordering is temporarily unavailable.' : 'Customer accounts are created and managed exclusively by the shop owner.') + '</p></div><form class="login-card" id="login-form"><p class="eyebrow">Secure account access</p><h2>Welcome back</h2><p class="subtext">Sign in with the username and password provided by the shop owner.</p><label class="field">Username<input name="username" required minlength="3" maxlength="32" autocapitalize="none" spellcheck="false" autocomplete="username"></label><label class="field">Password<input name="password" type="password" required autocomplete="current-password"></label><button class="primary full" type="submit">Sign in</button><button class="text-link full" id="forgot-password" type="button">Owner password recovery</button><div class="login-order-note"><b>Note</b><br>Order တင်လိုပါက Viber Number 09780000146 သို့ အရင် ဆက်သွယ်ပေးပါ။</div></form></div></section>';
    document.getElementById('forgot-password').addEventListener('click', renderForgotPassword);
    document.getElementById('login-form').addEventListener('submit', async function (event) {
      event.preventDefault();
      var data = new FormData(event.target);
      var button = event.target.querySelector('button[type="submit"]');
      button.disabled = true;
      button.textContent = 'Signing in…';

      try {
        var session = await accountService.login(String(data.get('username')).trim(), String(data.get('password')));
        currentUser = await loadAuthenticatedUser(session.user);
        if (currentUser.role === 'customer' && state.settings.maintenanceMode) {
          await supabaseClient.auth.signOut();
          currentUser = null;
          throw new Error('Customer ordering is temporarily under maintenance.');
        }
        await loadCatalogueData();
        await loadRemoteOrders();
        if (currentUser.role === 'owner' || currentUser.role === 'staff') {
          if (currentUser.role === 'owner') await loadManagedAccounts();
          renderAdmin();
        } else {
          await migrateLegacyCartOnce();
          renderCustomer();
        }
      } catch (error) {
        toast(error.message || 'Username or password is incorrect.');
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
    customerCatalogue = { items: [], total: 0, search: '', categoryId: '', loading: false, error: '', requestId: customerCatalogue.requestId + 1 };
    customerCategory = 'All';
    document.getElementById('app').innerHTML = topbar(true) + '<main class="customer-main"><section class="customer-hero"><div><p class="eyebrow">Hello, ' + esc(currentUser.name) + '</p><h1>Order your favourites</h1><p>Choose items, submit your order, and follow the confirmed quantities and shipping status from your customer menu.</p></div><label class="catalogue-search"><span class="hidden">Search products</span><input class="search" id="product-search" placeholder="Search products..." autocomplete="off"></label></section><section><div class="section-title"><h2>Our collection</h2><span id="product-count" aria-live="polite"></span></div><div class="category-filters" id="category-filters"></div><div class="product-grid" id="product-grid" aria-busy="true"></div><div class="catalogue-more" id="customer-product-more"></div></section></main><div id="customer-menu-root"></div><div id="modal-root"></div>';
    document.getElementById('open-cart').addEventListener('click', renderCart);
    document.getElementById('product-search').addEventListener('input', debounce(function (event) {
      customerCatalogue.search = event.target.value.trim();
      loadCustomerProducts(true);
    }, 350));
    document.getElementById('open-customer-menu').addEventListener('click', renderCustomerMenu);
    renderCategoryFilters();
    loadCustomerProducts(true);
  }

  function renderCategoryFilters() {
    var categories = state.categories.filter(function (category) { return category.is_active; });
    if (customerCategory !== 'All' && !categories.some(function (category) { return String(category.id) === String(customerCategory); })) customerCategory = 'All';
    document.getElementById('category-filters').innerHTML = '<button class="category-filter ' + (customerCategory === 'All' ? 'active' : '') + '" data-customer-category="">All</button>' + categories.map(function (category) {
      return '<button class="category-filter ' + (String(customerCategory) === String(category.id) ? 'active' : '') + '" data-customer-category="' + category.id + '">' + esc(category.name) + '</button>';
    }).join('');
    document.querySelectorAll('[data-customer-category]').forEach(function (button) {
      button.addEventListener('click', function () {
        customerCategory = button.dataset.customerCategory || 'All';
        customerCatalogue.categoryId = button.dataset.customerCategory || '';
        renderCategoryFilters();
        loadCustomerProducts(true);
      });
    });
  }

  function productSkeletons(count) {
    return Array.from({ length: count }).map(function () { return '<article class="product-card product-skeleton" aria-hidden="true"><div class="skeleton-block skeleton-photo"></div><div class="product-info"><div class="skeleton-block skeleton-line short"></div><div class="skeleton-block skeleton-line"></div><div class="skeleton-block skeleton-line medium"></div></div></article>'; }).join('');
  }

  async function loadCustomerProducts(reset) {
    if (customerCatalogue.loading && !reset) return;
    var requestId = ++customerCatalogue.requestId;
    if (reset) {
      customerCatalogue.items = [];
      customerCatalogue.total = 0;
      customerCatalogue.error = '';
    }
    customerCatalogue.loading = true;
    renderCustomerProducts();
    try {
      var result = await productCatalogueService.list({
        visibility: 'active',
        categoryId: customerCatalogue.categoryId,
        search: customerCatalogue.search,
        offset: reset ? 0 : customerCatalogue.items.length,
        limit: PAGE_SIZE
      });
      if (requestId !== customerCatalogue.requestId) return;
      var products = result.rows.map(mapDatabaseProduct);
      customerCatalogue.items = reset ? products : customerCatalogue.items.concat(products);
      customerCatalogue.total = result.count;
      customerCatalogue.error = '';
      mergeProductCache(products);
    } catch (error) {
      if (requestId !== customerCatalogue.requestId) return;
      customerCatalogue.error = error.message || 'Products could not be loaded.';
    } finally {
      if (requestId === customerCatalogue.requestId) {
        customerCatalogue.loading = false;
        renderCustomerProducts();
      }
    }
  }

  function renderCustomerProducts() {
    var grid = document.getElementById('product-grid');
    var count = document.getElementById('product-count');
    var more = document.getElementById('customer-product-more');
    if (!grid || !count || !more) return;
    count.textContent = customerCatalogue.loading && !customerCatalogue.items.length ? 'Loading products…' : 'Showing ' + customerCatalogue.items.length + ' of ' + customerCatalogue.total + ' product(s)';
    grid.setAttribute('aria-busy', customerCatalogue.loading ? 'true' : 'false');
    if (customerCatalogue.loading && !customerCatalogue.items.length) {
      grid.innerHTML = productSkeletons(6);
      more.innerHTML = '';
      return;
    }
    if (customerCatalogue.error && !customerCatalogue.items.length) {
      grid.innerHTML = '<div class="empty catalogue-error"><b>Products could not be loaded.</b><span>' + esc(customerCatalogue.error) + '</span><button class="secondary" id="retry-customer-products">Try again</button></div>';
      document.getElementById('retry-customer-products').addEventListener('click', function () { loadCustomerProducts(true); });
      more.innerHTML = '';
      return;
    }
    var products = customerCatalogue.items;
    grid.innerHTML = products.length ? products.map(function (product) {
      var hasPhoto = /^(data:image\/|https:\/\/)/.test(String(product.photo || ''));
      var photo = hasPhoto ? '<button class="product-photo photo-preview-button" data-preview-photo="' + product.id + '" aria-label="Preview ' + esc(product.name) + '" style="--product-bg:' + product.bg + '">' + photoMarkup(product) + '</button>' : '<div class="product-photo" style="--product-bg:' + product.bg + '">' + photoMarkup(product) + '</div>';
      return '<article class="product-card">' + photo + '<div class="product-info"><div class="product-category">' + esc(product.category) + '</div><div class="product-name">' + esc(product.name) + '</div><div class="product-meta"><span class="price">' + money(product.price) + ' / ' + esc(product.unit) + '</span><span>Minimum ' + product.minimumOrderQuantity + ' ' + esc(product.unit) + '</span></div><div class="card-footer"><input class="qty-input" id="qty-' + product.id + '" type="number" min="' + product.minimumOrderQuantity + '" step="1" value="' + product.minimumOrderQuantity + '"><button class="primary add-to-cart" data-product="' + product.id + '">Add</button></div></div></article>';
    }).join('') : '<div class="empty">No matching products found.</div>';
    document.querySelectorAll('[data-product]').forEach(function (button) {
      button.addEventListener('click', function () { addToCart(button.dataset.product, Number(document.getElementById('qty-' + button.dataset.product).value || 1)); });
    });
    document.querySelectorAll('[data-preview-photo]').forEach(function (button) {
      button.addEventListener('click', function () { renderPhotoPreview(button.dataset.previewPhoto); });
    });
    if (customerCatalogue.error) more.innerHTML = '<div class="inline-error">' + esc(customerCatalogue.error) + ' <button class="text-link" id="retry-customer-more">Retry</button></div>';
    else if (customerCatalogue.items.length < customerCatalogue.total) more.innerHTML = '<button class="secondary" id="load-more-products" ' + (customerCatalogue.loading ? 'disabled' : '') + '>' + (customerCatalogue.loading ? 'Loading…' : 'Load more products') + '</button>';
    else more.innerHTML = products.length ? '<span>All matching products are shown.</span>' : '';
    var retryMore = document.getElementById('retry-customer-more'); if (retryMore) retryMore.addEventListener('click', function () { loadCustomerProducts(false); });
    var loadMore = document.getElementById('load-more-products'); if (loadMore) loadMore.addEventListener('click', function () { loadCustomerProducts(false); });
  }

  function renderPhotoPreview(productId) {
    var product = getProduct(productId);
    if (!product || !/^(data:image\/|https:\/\/)/.test(String(product.photo || ''))) return;
    modal('<div class="modal-head"><div><p class="eyebrow">Product photo</p><h2>' + esc(product.name) + '</h2></div><button class="icon-btn" id="close-modal" aria-label="Close photo preview">×</button></div><div class="photo-lightbox loading" id="photo-lightbox"><span>Loading image…</span><img src="' + esc(product.photo) + '" alt="' + esc(product.name) + '"></div>');
    var image = document.querySelector('#photo-lightbox img');
    image.addEventListener('load', function () { image.parentElement.classList.remove('loading'); });
    image.addEventListener('error', function () { image.parentElement.className = 'photo-lightbox error'; image.parentElement.innerHTML = '<span>Photo could not be loaded.</span>'; });
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
    var orders = state.orders.filter(function (order) { return order.customerId === currentUser.id && String(order.orderNumber || order.id).toLowerCase().indexOf(search) > -1; });
    document.getElementById('recent-order-results').innerHTML = orders.length ? '<table><thead><tr><th>Order</th><th>Date</th><th>Status</th><th>Action</th></tr></thead><tbody>' + orders.map(function (order) { return '<tr><td class="order-id">' + esc(order.orderNumber || order.id) + '</td><td>' + order.date + '</td><td>' + badge(order.status) + '</td><td><div class="action-row"><button class="table-action" data-menu-order-details="' + order.id + '">Details</button>' + (voucherAvailable(order) ? '<button class="table-action" data-menu-order-voucher="' + order.id + '">Voucher</button>' : '') + '</div></td></tr>'; }).join('') + '</tbody></table>' : '<div class="cart-empty">No order matches that Order ID.</div>';
    document.querySelectorAll('[data-menu-order-details]').forEach(function (button) { button.addEventListener('click', function () { renderOrderDetails(button.dataset.menuOrderDetails); }); });
    document.querySelectorAll('[data-menu-order-voucher]').forEach(function (button) { button.addEventListener('click', function () { renderVoucher(button.dataset.menuOrderVoucher); }); });
  }

  async function addToCart(productId, quantity) {
    var product = getProduct(productId);
    if (!product) return;
    quantity = Number(quantity);
    if (!Number.isInteger(quantity) || quantity < product.minimumOrderQuantity) return toast('Enter at least the minimum whole-number quantity.');
    var existing = cart().find(function (item) { return String(item.productId) === String(productId); });
    try {
      await orderService.setCartItem(productId, (existing ? existing.quantity : 0) + quantity);
      await loadRemoteCart();
      document.querySelector('.cart-count').textContent = cartCount();
      toast(product.name + ' added to cart.');
    } catch (error) { toast(error.message || 'Item could not be added.'); }
  }

  function cartLines() {
    return cart().map(function (line) { return { product: getProduct(line.productId), quantity: line.quantity }; }).filter(function (line) { return line.product; });
  }

  async function ensureCachedProducts(ids) {
    var missing = ids.filter(function (id) { return !getProduct(id); });
    if (!missing.length) return;
    var rows = await productCatalogueService.getByIds(missing);
    mergeProductCache(rows.map(mapDatabaseProduct));
  }

  async function renderCart() {
    try {
      await loadRemoteCart();
      await ensureCachedProducts(cart().map(function (line) { return line.productId; }));
    } catch (error) {
      toast(error.message || 'Cart products could not be refreshed.');
    }
    var items = cartLines();
    modal('<div class="modal-head"><div><p class="eyebrow">Your order</p><h2>Shopping cart</h2></div><button class="icon-btn" id="close-modal">×</button></div>' + (items.length ? '<div>' + items.map(function (line) { return '<div class="cart-line"><div><b>' + esc(line.product.name) + '</b><span>' + money(line.product.price) + ' / ' + esc(line.product.unit) + ' · minimum ' + line.product.minimumOrderQuantity + '</span></div><input type="number" min="' + line.product.minimumOrderQuantity + '" step="1" value="' + line.quantity + '" data-cart-quantity="' + line.product.id + '"><div><button class="remove" data-remove-cart="' + line.product.id + '">Remove</button></div></div>'; }).join('') + '</div><button class="primary full" id="checkout">Place order</button>' : '<div class="cart-empty">Your cart is empty.</div>'));
    document.querySelectorAll('[data-cart-quantity]').forEach(function (input) {
      input.addEventListener('change', async function () {
        var item = cart().find(function (entry) { return String(entry.productId) === input.dataset.cartQuantity; });
        var product = getProduct(item.productId);
        var quantity = Number(input.value);
        if (!Number.isInteger(quantity) || quantity < product.minimumOrderQuantity) return toast('Quantity is below the product minimum.');
        try { await orderService.setCartItem(item.productId, quantity); await renderCart(); } catch (error) { toast(error.message || 'Cart could not be updated.'); }
      });
    });
    document.querySelectorAll('[data-remove-cart]').forEach(function (button) {
      button.addEventListener('click', async function () { try { await orderService.removeCartItem(button.dataset.removeCart); await renderCart(); document.querySelector('.cart-count').textContent = cartCount(); } catch (error) { toast(error.message || 'Item could not be removed.'); } });
    });
    var checkout = document.getElementById('checkout');
    if (checkout) checkout.addEventListener('click', renderCheckout);
  }

  function renderCheckout() {
    checkoutKey = checkoutKey || crypto.randomUUID();
    modal('<form id="checkout-form"><div class="modal-head"><div><p class="eyebrow">Final step</p><h2>Confirm your order</h2></div><button class="icon-btn" type="button" id="close-modal">×</button></div><p class="subtext">No online payment is needed. The shop will review and approve this order.</p><div class="form-grid"><label class="field">Contact phone<input name="phone" required placeholder="09xxxxxxxxx"></label><label class="field">Preferred delivery date<input name="deliveryDate" type="date"></label><label class="field full-field">Delivery address / လိပ်စာ<input name="address" required placeholder="House / Street / Township / City"></label><label class="field full-field">Bus station name / ကားဂိတ်အမည် (optional)<input name="busStation" placeholder="For out-of-town customer orders only"></label><label class="field full-field">Order note (optional)<input name="note"></label></div><div class="two-button"><button class="secondary" type="button" id="back-to-cart">Back</button><button class="primary" type="submit">Submit order</button></div></form>');
    document.getElementById('back-to-cart').addEventListener('click', renderCart);
    document.getElementById('checkout-form').addEventListener('submit', submitOrder);
  }

  async function submitOrder(event) {
    event.preventDefault();
    var lines = cartLines();
    if (!lines.length) return;
    var data = new FormData(event.target);
    var button = event.target.querySelector('button[type="submit"]');
    button.disabled = true; button.textContent = 'Submitting…';
    try {
      var result = await orderService.checkout({ idempotencyKey: checkoutKey, phone: data.get('phone'), address: data.get('address'), busStation: data.get('busStation'), deliveryDate: data.get('deliveryDate'), note: data.get('note') });
      checkoutKey = null;
      await loadRemoteCart(); await loadRemoteOrders();
      closeModal(); renderCustomer(); toast('Order ' + result[0].order_number + ' was submitted successfully.');
    } catch (error) {
      button.disabled = false; button.textContent = 'Submit order';
      toast(error.message || 'Order could not be submitted. Your cart is unchanged.');
    }
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
    document.getElementById('customer-orders').innerHTML = orders.length ? '<table><thead><tr><th>Order</th><th>Date</th><th>Items</th><th>Status</th><th>Action</th></tr></thead><tbody>' + orders.map(function (order) { return '<tr><td class="order-id">' + esc(order.orderNumber || order.id) + '</td><td>' + order.date + '</td><td>' + orderCount(order) + '</td><td>' + badge(order.status) + '</td><td><div class="action-row"><button class="table-action" data-view-order="' + order.id + '">Details</button>' + (voucherAvailable(order) ? '<button class="table-action" data-customer-voucher="' + order.id + '">Voucher</button>' : '') + '</div></td></tr>'; }).join('') + '</tbody></table>' : '<div class="cart-empty">You have not placed an order yet.</div>';
    document.querySelectorAll('[data-view-order]').forEach(function (button) { button.addEventListener('click', function () { renderOrderDetails(button.dataset.viewOrder); }); });
    document.querySelectorAll('[data-customer-voucher]').forEach(function (button) { button.addEventListener('click', function () { renderVoucher(button.dataset.customerVoucher); }); });
  }

  function renderOrderDetails(orderId) {
    var order = state.orders.find(function (entry) { return entry.id === orderId; });
    if (!order || (currentUser.role !== 'owner' && order.customerId !== currentUser.id)) return;
    var isCustomer = currentUser.role === 'customer';
    var quantityNotices = order.items.filter(function (item) { return item.confirmedQuantity !== item.quantity; }).map(function (item) {
      return '<div>Shop adjusted quantity from ' + item.quantity + ' to ' + item.confirmedQuantity + ' for ' + esc(item.productName) + '.</div>';
    }).join('');
    var rows = order.items.map(function (item) {
      var product = getProduct(item.productId);
      return '<tr><td>' + esc(product ? product.name : item.productName) + '</td><td>' + visibleQuantity(order, item) + '</td><td>' + money(visibleUnitPrice(order, item)) + '</td><td>' + money(visibleLineTotal(order, item)) + '</td></tr>';
    }).join('');
    modal('<div class="modal-head"><div><p class="eyebrow">Order details</p><h2>' + esc(order.orderNumber || order.id) + '</h2></div><button class="icon-btn" id="close-modal">×</button></div>' + (isCustomer && quantityNotices ? '<div class="order-alert">' + quantityNotices + '</div>' : '') + '<p class="subtext"><b>Status:</b> ' + badge(order.status) + (order.note ? '<br><b>Note:</b> ' + esc(order.note) : '') + '</p><div class="table-wrap"><table><thead><tr><th>Item</th><th>' + (usesConfirmedValues(order) ? 'Confirmed qty' : 'Requested qty') + '</th><th>Unit price</th><th>Line total</th></tr></thead><tbody>' + rows + '</tbody></table></div><div class="cart-total"><span>' + (usesConfirmedValues(order) ? 'Final payable total' : 'Original order total') + '</span><b>' + money(visibleOrderTotal(order)) + '</b></div>' + (voucherAvailable(order) ? '<div class="two-button"><button class="primary" id="view-voucher">View / print voucher</button></div>' : ''));
    var viewVoucher = document.getElementById('view-voucher');
    if (viewVoucher) viewVoucher.addEventListener('click', function () { renderVoucher(order.id); });
  }

  function renderAdmin() {
    var accountNavigation = currentUser.role === 'owner' ? '<button class="nav-button" data-page="customers">Customers</button><button class="nav-button" data-page="owners">Owner accounts</button>' : '';
    document.getElementById('app').innerHTML = topbar(false) + '<div class="admin-layout"><aside class="sidebar"><div class="admin-brand">Yadanar Theingi<span>Owner dashboard</span></div><button class="nav-button" data-page="dashboard">Dashboard</button><button class="nav-button" data-page="orders">Orders</button><button class="nav-button" data-page="products">Products</button><button class="nav-button" data-page="inventory">Inventory</button>' + accountNavigation + '<button class="nav-button" data-page="settings">Settings</button></aside><main class="admin-content" id="admin-content"></main></div><div id="modal-root"></div>';
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
    return '<div class="page-heading"><div><p class="eyebrow">Overview</p><h1>Good morning, Owner</h1><p>Review new orders and keep stock ready for shipping.</p></div><button class="primary" data-go="orders">View orders</button></div><section class="dashboard-stats">' + stat('New orders', pending, pending ? 'Needs your review' : 'All caught up') + stat('Delivered revenue', money(revenue), 'Delivered orders') + stat('Active customers', customers, 'Owner-managed accounts') + '<article class="stat-card"><div class="stat-label">Low stock items</div><div class="stat-value" id="low-stock-count">...</div><div class="stat-change" id="low-stock-note">Checking stock levels</div></article></section><section class="admin-grid"><div class="panel"><h2 class="panel-title">Recent orders <button class="text-link" data-go="orders">View all</button></h2>' + adminOrderTable(state.orders.slice().sort(function (a, b) { return b.id - a.id; }).slice(0, 5), false) + '</div><div class="panel"><h2 class="panel-title">Low stock</h2><div id="dashboard-low-stock" aria-busy="true">' + productSkeletons(3) + '</div></div></section>';
  }

  async function loadDashboardLowStock() {
    var target = document.getElementById('dashboard-low-stock');
    if (!target) return;
    dashboardLowStock.loading = true;
    try {
      var result = await supabaseClient.from('products').select('id, name, stock_quantity, category_id, categories(name)', { count: 'exact' }).eq('is_active', true).lt('stock_quantity', 10).order('stock_quantity', { ascending: true }).order('id', { ascending: true }).limit(10);
      if (result.error) throw result.error;
      dashboardLowStock.items = (result.data || []).map(mapDatabaseProduct);
      dashboardLowStock.total = Number(result.count) || 0;
      dashboardLowStock.error = '';
      target.innerHTML = stockList(dashboardLowStock.items);
      target.setAttribute('aria-busy', 'false');
      var count = document.getElementById('low-stock-count');
      var note = document.getElementById('low-stock-note');
      if (count) count.textContent = dashboardLowStock.total;
      if (note) note.textContent = dashboardLowStock.total ? 'Restock soon' : 'Stock levels are good';
    } catch (error) {
      dashboardLowStock.error = error.message || 'Stock levels could not be loaded.';
      target.setAttribute('aria-busy', 'false');
      target.innerHTML = '<div class="inline-error">' + esc(dashboardLowStock.error) + ' <button class="text-link" id="retry-low-stock">Retry</button></div>';
      document.getElementById('retry-low-stock').addEventListener('click', loadDashboardLowStock);
      var failedCount = document.getElementById('low-stock-count');
      var failedNote = document.getElementById('low-stock-note');
      if (failedCount) failedCount.textContent = '-';
      if (failedNote) failedNote.textContent = 'Could not load stock';
    } finally {
      dashboardLowStock.loading = false;
    }
  }

  function stat(label, value, note) {
    return '<article class="stat-card"><div class="stat-label">' + label + '</div><div class="stat-value">' + value + '</div><div class="stat-change">' + note + '</div></article>';
  }

  function ordersPage() {
    return '<div class="page-heading"><div><p class="eyebrow">Order management</p><h1>Orders</h1><p>Review requested quantities and move orders through delivery.</p></div></div><div class="panel owner-search-panel"><input class="search" id="owner-order-search" placeholder="Search Order ID or customer name..."></div><div class="panel table-wrap" id="owner-order-results">' + adminOrderTable(state.orders, true) + '</div>';
  }

  function adminOrderTable(orders, editable) {
    if (!orders.length) return '<div class="cart-empty">No orders yet.</div>';
    var statuses = ['Pending', 'Approved', 'Processing', 'Ready to Ship', 'Delivered'];
    return '<table><thead><tr><th>Order</th><th>Customer</th><th>Items</th><th>Total</th><th>Status</th>' + (editable ? '<th>Action</th>' : '') + '</tr></thead><tbody>' + orders.map(function (order) {
      var control = editable ? '<select class="status-select" data-status="' + order.id + '">' + statuses.map(function (status) { return '<option value="' + status + '" ' + (order.status === status ? 'selected' : '') + '>' + status + '</option>'; }).join('') + '</select>' : badge(order.status);
      return '<tr><td><span class="order-id">' + esc(order.orderNumber || order.id) + '</span><br><small>' + order.date + '</small></td><td><b>' + esc(order.customer) + '</b><br><small>' + esc(order.phone || 'No phone') + '</small></td><td>' + orderCount(order) + (order.adjusted ? '<br><small>Adjusted</small>' : '') + '</td><td>' + money(order.total) + '</td><td>' + control + '</td>' + (editable ? '<td><div class="action-row"><button class="table-action" data-owner-order-view="' + order.id + '">View</button><button class="table-action" data-owner-voucher="' + order.id + '">Voucher</button></div></td>' : '') + '</tr>';
    }).join('') + '</tbody></table>';
  }

  function matchingOwnerOrders(query) {
    var term = String(query || '').trim().toLowerCase();
    var idTerm = term.replace(/\D/g, '');
    return state.orders.filter(function (order) {
      return !term || String(order.customer || '').toLowerCase().indexOf(term) !== -1 || (idTerm && String(order.orderNumber || order.id).indexOf(idTerm) !== -1) || String(order.orderNumber || order.id).toLowerCase().indexOf(term.replace('#', '')) !== -1;
    });
  }

  function bindOrderTableActions(scope) {
    var root = scope || document;
    root.querySelectorAll('[data-status]').forEach(function (select) { select.addEventListener('change', function () { updateStatus(select.dataset.status, select.value); }); });
    root.querySelectorAll('[data-owner-order-view]').forEach(function (button) { button.addEventListener('click', function () { renderTransactionalOwnerOrderModal(button.dataset.ownerOrderView); }); });
    root.querySelectorAll('[data-owner-voucher]').forEach(function (button) { button.addEventListener('click', function () { renderVoucher(button.dataset.ownerVoucher); }); });
  }

  function productsPage() {
    var categoryOptions = state.categories.map(function (category) { return '<option value="' + category.id + '" ' + (String(ownerCatalogue.categoryId) === String(category.id) ? 'selected' : '') + '>' + esc(category.name) + '</option>'; }).join('');
    return '<div class="page-heading"><div><p class="eyebrow">Catalogue</p><h1>Products</h1><p>Search and manage the catalogue without loading every product at once.</p></div><div class="action-row"><button class="secondary" id="export-products">Export products</button><button class="secondary" id="adjust-category">Adjust category prices</button><button class="primary" id="new-product">+ Add product</button></div></div><section class="panel catalogue-toolbar"><label class="field">Search products<input id="owner-product-search" value="' + esc(ownerCatalogue.search) + '" placeholder="Product name..." autocomplete="off"></label><label class="field">Category<select id="owner-product-category"><option value="">All Categories</option>' + categoryOptions + '</select></label><label class="field">Status<select id="owner-product-status"><option value="all" ' + (ownerCatalogue.visibility === 'all' ? 'selected' : '') + '>Active and inactive</option><option value="active" ' + (ownerCatalogue.visibility === 'active' ? 'selected' : '') + '>Active only</option><option value="inactive" ' + (ownerCatalogue.visibility === 'inactive' ? 'selected' : '') + '>Inactive only</option></select></label></section><div class="catalogue-result-heading"><span id="owner-product-count" aria-live="polite"></span></div><div class="panel table-wrap" id="owner-product-results" aria-busy="true"></div><div class="catalogue-more" id="owner-product-more"></div>';
  }

  async function loadOwnerProducts(reset) {
    if (ownerCatalogue.loading && !reset) return;
    var requestId = ++ownerCatalogue.requestId;
    if (reset) {
      ownerCatalogue.items = [];
      ownerCatalogue.total = 0;
      ownerCatalogue.error = '';
    }
    ownerCatalogue.loading = true;
    renderOwnerProducts();
    try {
      var result = await productCatalogueService.list({
        visibility: ownerCatalogue.visibility,
        categoryId: ownerCatalogue.categoryId,
        search: ownerCatalogue.search,
        offset: reset ? 0 : ownerCatalogue.items.length,
        limit: PAGE_SIZE
      });
      if (requestId !== ownerCatalogue.requestId) return;
      var products = result.rows.map(mapDatabaseProduct);
      ownerCatalogue.items = reset ? products : ownerCatalogue.items.concat(products);
      ownerCatalogue.total = result.count;
      ownerCatalogue.error = '';
      mergeProductCache(products);
    } catch (error) {
      if (requestId !== ownerCatalogue.requestId) return;
      ownerCatalogue.error = error.message || 'Products could not be loaded.';
    } finally {
      if (requestId === ownerCatalogue.requestId) {
        ownerCatalogue.loading = false;
        renderOwnerProducts();
      }
    }
  }

  function renderOwnerProducts() {
    var results = document.getElementById('owner-product-results');
    var count = document.getElementById('owner-product-count');
    var more = document.getElementById('owner-product-more');
    if (!results || !count || !more) return;
    count.textContent = ownerCatalogue.loading && !ownerCatalogue.items.length ? 'Loading products…' : 'Showing ' + ownerCatalogue.items.length + ' of ' + ownerCatalogue.total + ' product(s)';
    results.setAttribute('aria-busy', ownerCatalogue.loading ? 'true' : 'false');
    if (ownerCatalogue.loading && !ownerCatalogue.items.length) {
      results.innerHTML = '<div class="table-skeleton">' + Array.from({ length: 6 }).map(function () { return '<div class="skeleton-row"><span></span><span></span><span></span><span></span></div>'; }).join('') + '</div>';
      more.innerHTML = '';
      return;
    }
    if (ownerCatalogue.error && !ownerCatalogue.items.length) {
      results.innerHTML = '<div class="empty catalogue-error"><b>Products could not be loaded.</b><span>' + esc(ownerCatalogue.error) + '</span><button class="secondary" id="retry-owner-products">Try again</button></div>';
      document.getElementById('retry-owner-products').addEventListener('click', function () { loadOwnerProducts(true); });
      more.innerHTML = '';
      return;
    }
    var products = ownerCatalogue.items;
    results.innerHTML = products.length ? '<table><thead><tr><th>Product</th><th>Category</th><th>Price</th><th>Unit / minimum</th><th>Stock</th><th>Status</th><th>Action</th></tr></thead><tbody>' + products.map(function (product) {
      var status = product.deleted ? '<span class="badge disabled">Inactive</span>' : '<span class="badge active">Active</span>';
      var availabilityAction = product.deleted ? '<button class="table-action" data-reactivate-product="' + product.id + '">Reactivate</button>' : '<button class="table-action delete-action" data-delete-product="' + product.id + '">Deactivate</button>';
      return '<tr><td><div class="product-cell">' + photoMarkup(product, 'table-photo') + '<b>' + esc(product.name) + '</b></div></td><td>' + esc(product.category) + '</td><td>' + money(product.price) + '</td><td><b>' + esc(product.unit) + '</b><br><small>Minimum ' + product.minimumOrderQuantity + '</small></td><td><b class="' + (product.stock < 10 ? 'low' : '') + '">' + product.stock + '</b></td><td>' + status + '</td><td><div class="action-row"><button class="table-action" data-edit-product="' + product.id + '">Edit</button><button class="table-action" data-manual-stock="' + product.id + '">Adjust stock</button>' + availabilityAction + '</div></td></tr>';
    }).join('') + '</tbody></table>' : '<div class="empty">No matching products found.</div>';
    bindProductTableActions(results);
    if (ownerCatalogue.error) more.innerHTML = '<div class="inline-error">' + esc(ownerCatalogue.error) + ' <button class="text-link" id="retry-owner-more">Retry</button></div>';
    else if (ownerCatalogue.items.length < ownerCatalogue.total) more.innerHTML = '<button class="secondary" id="load-more-owner-products" ' + (ownerCatalogue.loading ? 'disabled' : '') + '>' + (ownerCatalogue.loading ? 'Loading…' : 'Load more products') + '</button>';
    else more.innerHTML = products.length ? '<span>All matching products are shown.</span>' : '';
    var retryMore = document.getElementById('retry-owner-more'); if (retryMore) retryMore.addEventListener('click', function () { loadOwnerProducts(false); });
    var loadMore = document.getElementById('load-more-owner-products'); if (loadMore) loadMore.addEventListener('click', function () { loadOwnerProducts(false); });
  }

  function bindProductTableActions(root) {
    root.querySelectorAll('[data-edit-product]').forEach(function (button) { button.addEventListener('click', function () { renderProductForm(button.dataset.editProduct); }); });
    root.querySelectorAll('[data-manual-stock]').forEach(function (button) { button.addEventListener('click', function () { renderManualStockAdjust(button.dataset.manualStock); }); });
    root.querySelectorAll('[data-delete-product]').forEach(function (button) { button.addEventListener('click', function () { renderProductDelete(button.dataset.deleteProduct); }); });
    root.querySelectorAll('[data-reactivate-product]').forEach(function (button) { button.addEventListener('click', function () { reactivateProduct(button.dataset.reactivateProduct); }); });
  }

  function inventoryPage() {
    return '<div class="page-heading"><div><p class="eyebrow">Stock control</p><h1>Inventory in / out</h1><p>Record supplier deliveries, stock changes and customer order movements.</p></div><button class="primary" id="new-stock">+ Record stock movement</button></div><section class="admin-grid"><div class="panel table-wrap"><h2 class="panel-title">Recent movements</h2><table><thead><tr><th>Date</th><th>Product</th><th>Type</th><th>Qty</th><th>Note</th></tr></thead><tbody>' + state.inventory.slice().sort(function (a, b) { return b.id - a.id; }).slice(0, 20).map(function (move) { return '<tr><td>' + move.date + '</td><td><b>' + esc(move.product) + '</b></td><td><span class="badge ' + (move.type === 'IN' ? 'approved' : 'pending') + '">' + move.type + '</span></td><td>' + move.quantity + '</td><td>' + esc(move.note) + '</td></tr>'; }).join('') + '</tbody></table></div><div class="panel"><h2 class="panel-title">Current stock</h2>' + stockList(state.products.slice().sort(function (a, b) { return a.stock - b.stock; })) + '</div></section>';
  }

  function stockList(products) {
    return products.length ? products.map(function (product) { return '<div class="stock-row"><div><b>' + esc(product.name) + '</b><small>' + esc(product.category) + '</small></div><b class="' + (product.stock < 10 ? 'low' : '') + '">' + product.stock + ' left</b></div>'; }).join('') : '<div class="cart-empty">All products are above the low-stock threshold.</div>';
  }

  function customersPage() {
    var customers = state.users.filter(function (user) { return user.role === 'customer'; });
    return '<div class="page-heading"><div><p class="eyebrow">Access control</p><h1>Customer accounts</h1><p>Create accounts, control access and reset customer passwords.</p></div><button class="primary" id="new-customer">+ Create customer account</button></div><div class="panel table-wrap"><table><thead><tr><th>Customer</th><th>Username</th><th>Orders</th><th>Access</th><th>Action</th></tr></thead><tbody>' + customers.map(function (customer) { return '<tr><td><b>' + esc(customer.name) + '</b></td><td>' + esc(customer.username) + '</td><td>' + state.orders.filter(function (order) { return String(order.customerId) === String(customer.id); }).length + '</td><td>' + badge(customer.status) + '</td><td><div class="action-row"><button class="table-action" data-toggle-account="' + customer.id + '">' + (customer.status === 'Active' ? 'Disable' : 'Enable') + '</button><button class="table-action" data-reset-account="' + customer.id + '">Reset password</button></div></td></tr>'; }).join('') + '</tbody></table></div>';
  }

  function ownersPage() {
    var owners = state.users.filter(function (user) { return user.role === 'owner' || user.role === 'staff'; });
    return '<div class="page-heading"><div><p class="eyebrow">Access control</p><h1>Owner accounts</h1><p>The primary owner keeps email recovery. Additional staff use owner-managed username accounts.</p></div><button class="primary" id="new-owner">+ Create staff account</button></div><div class="panel table-wrap"><table><thead><tr><th>Owner / staff</th><th>Username</th><th>Created</th><th>Access</th><th>Action</th></tr></thead><tbody>' + owners.map(function (owner) { var managed = owner.role === 'staff'; return '<tr><td><b>' + esc(owner.name) + '</b><br><small>' + (managed ? 'Managed staff' : 'Primary owner') + '</small></td><td>' + esc(owner.username) + '</td><td>' + owner.created + '</td><td>' + badge(owner.status) + '</td><td>' + (managed ? '<div class="action-row"><button class="table-action" data-toggle-account="' + owner.id + '">' + (owner.status === 'Active' ? 'Disable' : 'Enable') + '</button><button class="table-action" data-reset-account="' + owner.id + '">Reset password</button></div>' : '<small>Uses email recovery</small>') + '</td></tr>'; }).join('') + '</tbody></table></div>';
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
    document.querySelectorAll('[data-toggle-account]').forEach(function (button) { button.addEventListener('click', function () { updateAccountAccess(button.dataset.toggleAccount); }); });
    document.querySelectorAll('[data-reset-account]').forEach(function (button) { button.addEventListener('click', function () { renderPasswordResetForm(button.dataset.resetAccount); }); });
    var newProduct = document.getElementById('new-product'); if (newProduct) newProduct.addEventListener('click', function () { renderProductForm(); });
    var exportProducts = document.getElementById('export-products'); if (exportProducts) exportProducts.addEventListener('click', renderDatabaseProductExport);
    var adjustCategory = document.getElementById('adjust-category'); if (adjustCategory) adjustCategory.addEventListener('click', renderDatabaseCategoryAdjust);
    var newStock = document.getElementById('new-stock'); if (newStock) newStock.addEventListener('click', renderStockForm);
    var newCustomer = document.getElementById('new-customer'); if (newCustomer) newCustomer.addEventListener('click', function () { renderAccountForm('customer'); });
    var newOwner = document.getElementById('new-owner'); if (newOwner) newOwner.addEventListener('click', function () { renderAccountForm('staff'); });
    var siteSettings = document.getElementById('site-settings'); if (siteSettings) siteSettings.addEventListener('submit', saveSiteSettings);
    var voucherSettings = document.getElementById('voucher-settings'); if (voucherSettings) voucherSettings.addEventListener('submit', saveVoucherSettings);
    var download = document.getElementById('download-backup'); if (download) download.addEventListener('click', downloadBackup);
    var restore = document.getElementById('restore-backup'); if (restore) restore.addEventListener('change', restoreBackup);
    var ownerProductSearch = document.getElementById('owner-product-search');
    var ownerProductCategory = document.getElementById('owner-product-category');
    var ownerProductStatus = document.getElementById('owner-product-status');
    if (ownerProductSearch && ownerProductCategory && ownerProductStatus) {
      ownerProductSearch.addEventListener('input', debounce(function (event) { ownerCatalogue.search = event.target.value.trim(); loadOwnerProducts(true); }, 350));
      ownerProductCategory.addEventListener('change', function () { ownerCatalogue.categoryId = ownerProductCategory.value; loadOwnerProducts(true); });
      ownerProductStatus.addEventListener('change', function () { ownerCatalogue.visibility = ownerProductStatus.value; loadOwnerProducts(true); });
      loadOwnerProducts(true);
    }
    if (document.getElementById('dashboard-low-stock')) loadDashboardLowStock();
    var ownerOrderSearch = document.getElementById('owner-order-search');
    if (ownerOrderSearch) ownerOrderSearch.addEventListener('input', function () {
      var results = document.getElementById('owner-order-results');
      results.innerHTML = adminOrderTable(matchingOwnerOrders(ownerOrderSearch.value), true);
      bindOrderTableActions(results);
    });
    ['voucher-title', 'voucher-color', 'voucher-footer'].forEach(function (id) { var input = document.getElementById(id); if (input) input.addEventListener('input', renderLiveVoucherPreview); });
  }

  function renderProductExport() {
    var categoryNames = state.categories.slice().sort(function (a, b) { return a.name.localeCompare(b.name); });
    modal('<form id="product-export-form"><div class="modal-head"><div><p class="eyebrow">Excel export</p><h2>Export products</h2></div><button class="icon-btn" id="close-modal" type="button">×</button></div><p class="subtext">Download a new .xlsx file based on the YDG product template. Product photos and units are included.</p><label class="field">Category<select name="category"><option value="All Categories">All Categories</option>' + categoryNames.map(function (category) { return '<option value="' + esc(category) + '">' + esc(category) + '</option>'; }).join('') + '</select></label><fieldset class="export-choice"><legend>Products to include</legend><label><input type="radio" name="activity" value="active" checked> Active products only</label><label><input type="radio" name="activity" value="all"> Include inactive products</label></fieldset><p class="export-status" id="product-export-status" aria-live="polite">Choose the export options, then download the workbook.</p><div class="two-button"><button class="secondary" id="cancel-product-export" type="button">Cancel</button><button class="primary" id="download-product-export" type="submit">Download .xlsx</button></div></form>');
    document.getElementById('cancel-product-export').addEventListener('click', closeModal);
    document.getElementById('product-export-form').addEventListener('submit', async function (event) {
      event.preventDefault();
      var form = event.currentTarget;
      var data = new FormData(form);
      var category = data.get('category');
      var includeInactive = data.get('activity') === 'all';
      var products = state.products.filter(function (product) {
        return (includeInactive || !product.deleted) && (category === 'All Categories' || product.category === category);
      }).sort(function (a, b) { return a.name.localeCompare(b.name); });
      var button = document.getElementById('download-product-export');
      var status = document.getElementById('product-export-status');
      if (!products.length) {
        status.className = 'export-status error';
        status.textContent = 'No products match the selected export options.';
        return;
      }
      button.disabled = true;
      button.textContent = 'Generating…';
      status.className = 'export-status loading';
      try {
        var result = await window.ProductExportService.exportProducts({
          products: products,
          category: category,
          onStatus: function (message) { status.textContent = message; }
        });
        status.className = 'export-status success';
        status.textContent = result.count + ' product(s) exported successfully. Download started.';
        button.textContent = 'Download again';
        toast('Product Excel download started.');
      } catch (error) {
        status.className = 'export-status error';
        status.textContent = error.message || 'The Excel file could not be generated.';
        button.textContent = 'Try again';
      } finally {
        button.disabled = false;
      }
    });
  }

  function renderTransactionalOwnerOrderModal(orderId) {
    var order = state.orders.find(function (entry) { return entry.id === orderId; });
    if (!order) return;
    var rows = order.items.map(function (item) {
      return '<tr><td><b>' + esc(item.productName) + '</b><br><small>Requested at ' + money(item.unitPrice) + ' / ' + esc(item.unit) + '</small></td><td>' + item.quantity + '</td><td><input class="qty-input" type="number" min="1" step="1" value="' + item.confirmedQuantity + '" data-confirmed-quantity="' + item.id + '"></td><td><input class="checklist-price-input" type="number" min="0" step="1" value="' + item.confirmedUnitPrice + '" data-confirmed-unit-price="' + item.id + '"></td><td><input class="qty-input" type="number" min="0" max="' + item.confirmedQuantity + '" value="' + item.allocatedQuantity + '" data-allocation="' + item.id + '"></td></tr>';
    }).join('');
    modal('<div class="modal-head"><div><p class="eyebrow">' + esc(order.orderNumber || order.id) + '</p><h2>Order confirmation</h2></div><button class="icon-btn" id="close-modal" type="button">×</button></div><div class="order-view-summary"><div><span>Customer</span><b>' + esc(order.customer) + '</b><small>' + esc(order.phone || 'Phone not recorded') + '</small></div><div><span>Delivery</span><b>' + esc(order.address) + '</b></div><div><span>Status</span>' + badge(order.status) + '<small>' + order.date + '</small></div></div><p class="subtext">Requested quantity and price remain unchanged for audit. Confirmed values become payable when status reaches Ready to Ship. Only quantity differences create a customer adjustment notice.</p><div class="table-wrap"><table><thead><tr><th>Item</th><th>Requested qty</th><th>Confirmed qty</th><th>Confirmed unit price</th><th>Stock allocated</th></tr></thead><tbody>' + rows + '</tbody></table></div><div class="cart-total"><span>Original total</span><b>' + money(order.total) + '</b></div><div class="cart-total"><span>Confirmed total</span><b>' + money(order.confirmedTotal) + '</b></div><button class="primary full" id="save-allocations">Save confirmation</button>');
    document.getElementById('save-allocations').addEventListener('click', async function (event) {
      var button = event.currentTarget; button.disabled = true; button.textContent = 'Saving…';
      try {
        var inputs = Array.from(document.querySelectorAll('[data-confirmed-quantity]'));
        for (var index = 0; index < inputs.length; index += 1) {
          var itemId = inputs[index].dataset.confirmedQuantity;
          var quantity = Number(inputs[index].value);
          var unitPrice = Number(document.querySelector('[data-confirmed-unit-price="' + itemId + '"]').value);
          var allocation = Number(document.querySelector('[data-allocation="' + itemId + '"]').value);
          if (!Number.isInteger(quantity) || quantity < 1) throw new Error('Confirmed quantities must be positive whole numbers.');
          if (!Number.isFinite(unitPrice) || unitPrice < 0) throw new Error('Confirmed unit prices cannot be negative.');
          if (!Number.isInteger(allocation) || allocation < 0 || allocation > quantity) throw new Error('Allocated quantity must be between 0 and confirmed quantity.');
          var original = order.items.find(function (item) { return item.id === itemId; });
          if (quantity !== original.confirmedQuantity || unitPrice !== original.confirmedUnitPrice || allocation !== original.allocatedQuantity) await orderService.confirmItem(original.id, quantity, unitPrice, allocation);
        }
        await loadRemoteOrders(); await loadCatalogueData(); renderAdminPage(); closeModal(); toast('Order confirmation updated.');
      } catch (error) { button.disabled = false; button.textContent = 'Save confirmation'; toast(error.message || 'Order confirmation could not be saved.'); }
    });
  }

  function usesConfirmedValues(order) {
    return order.status === 'Ready to Ship' || order.status === 'Delivered';
  }

  function visibleQuantity(order, item) {
    return usesConfirmedValues(order) ? item.confirmedQuantity : item.quantity;
  }

  function visibleUnitPrice(order, item) {
    return usesConfirmedValues(order) ? item.confirmedUnitPrice : item.unitPrice;
  }

  function visibleLineTotal(order, item) {
    return visibleQuantity(order, item) * visibleUnitPrice(order, item);
  }

  function visibleOrderTotal(order) {
    return usesConfirmedValues(order) ? order.confirmedTotal : order.total;
  }

  async function updateStatus(orderId, status) {
    var order = state.orders.find(function (entry) { return entry.id === orderId; });
    if (!order) return;
    try {
      await orderService.updateStatus(orderId, status.toLowerCase().replace(/\s+/g, '_'));
      await loadRemoteOrders(); renderAdminPage(); toast('Order ' + (order.orderNumber || orderId) + ' updated to ' + status + '.');
    } catch (error) { toast(error.message || 'Order status could not be updated.'); }
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
    var categoryNames = state.categories.map(function (category) { return category.name; });
    var selectedPhotoFile = null;
    modal('<form id="product-form"><div class="modal-head"><div><p class="eyebrow">Catalogue</p><h2>' + (product ? 'Edit product' : 'Add product') + '</h2></div><button class="icon-btn" id="close-modal" type="button">×</button></div><div class="form-grid"><label class="field full-field">Product name<input name="name" required value="' + (product ? esc(product.name) : '') + '"></label><div class="field category-combobox"><label for="product-category">Category</label><input id="product-category" name="category" role="combobox" aria-autocomplete="list" aria-controls="category-suggestions" aria-expanded="false" required autocomplete="off" value="' + (product ? esc(product.category) : '') + '"><div class="category-suggestions" id="category-suggestions" role="listbox" hidden></div></div><label class="field">Price (MMK)<input name="price" type="number" min="0" required value="' + (product ? product.price : '') + '"></label><label class="field">Current stock<input name="stock" type="number" min="0" step="1" required value="' + (product ? product.stock : '') + '"></label><label class="field">Unit<select name="unit" required><option value="pcs" ' + (!product || product.unit === 'pcs' ? 'selected' : '') + '>pcs</option><option value="box" ' + (product && product.unit === 'box' ? 'selected' : '') + '>box</option></select></label><label class="field">Minimum order quantity<input name="minimumOrderQuantity" type="number" min="1" step="1" required value="' + (product ? product.minimumOrderQuantity : 1) + '"></label><div class="field full-field"><span>Product photo</span><div class="photo-drop-zone" id="product-photo-drop" role="button" tabindex="0" aria-label="Browse or drop a product photo"><input id="product-photo" type="file" accept="image/jpeg,image/png,image/webp" hidden><button class="secondary" id="browse-product-photo" type="button">Browse image</button><span>or drag and drop here</span><small>JPEG, PNG or WebP · Maximum 500 KB</small></div><p class="photo-file-status" id="product-photo-status" aria-live="polite">' + (product && product.photo ? 'Current photo will be kept unless a new image is selected.' : 'No image selected.') + '</p></div><div class="photo-upload-preview full-field" id="product-preview">' + photoMarkup(product || { name: 'New product', photo: '' }) + '</div></div><div class="two-button"><button class="primary" type="submit">Save product</button></div></form>');

    var categoryInput = document.getElementById('product-category');
    var categoryList = document.getElementById('category-suggestions');
    var categoryMatches = [];
    var highlightedCategory = -1;

    function closeCategorySuggestions() {
      categoryList.hidden = true;
      categoryList.innerHTML = '';
      categoryInput.setAttribute('aria-expanded', 'false');
      categoryInput.removeAttribute('aria-activedescendant');
      highlightedCategory = -1;
    }

    function highlightCategory(index) {
      highlightedCategory = index;
      categoryList.querySelectorAll('[role="option"]').forEach(function (option, optionIndex) {
        option.classList.toggle('active', optionIndex === index);
        option.setAttribute('aria-selected', optionIndex === index ? 'true' : 'false');
      });
      if (index >= 0) categoryInput.setAttribute('aria-activedescendant', 'category-option-' + index);
    }

    function showCategorySuggestions() {
      var query = categoryInput.value.trim().toLowerCase();
      if (!query) return closeCategorySuggestions();
      categoryMatches = categoryNames.filter(function (name) { return name.toLowerCase().indexOf(query) !== -1; }).slice(0, 8);
      if (!categoryMatches.length) return closeCategorySuggestions();
      categoryList.innerHTML = categoryMatches.map(function (name, index) { return '<button id="category-option-' + index + '" type="button" role="option" aria-selected="false" data-category-index="' + index + '">' + esc(name) + '</button>'; }).join('');
      categoryList.hidden = false;
      categoryInput.setAttribute('aria-expanded', 'true');
      highlightedCategory = -1;
    }

    function chooseCategory(index) {
      if (!categoryMatches[index]) return;
      categoryInput.value = categoryMatches[index];
      closeCategorySuggestions();
      categoryInput.focus();
    }

    categoryInput.addEventListener('input', showCategorySuggestions);
    categoryInput.addEventListener('focus', showCategorySuggestions);
    categoryInput.addEventListener('blur', function () { setTimeout(closeCategorySuggestions, 120); });
    categoryInput.addEventListener('keydown', function (event) {
      if (categoryList.hidden && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) showCategorySuggestions();
      if (categoryList.hidden) return;
      if (event.key === 'ArrowDown') { event.preventDefault(); highlightCategory((highlightedCategory + 1) % categoryMatches.length); }
      if (event.key === 'ArrowUp') { event.preventDefault(); highlightCategory((highlightedCategory - 1 + categoryMatches.length) % categoryMatches.length); }
      if (event.key === 'Enter' && highlightedCategory >= 0) { event.preventDefault(); chooseCategory(highlightedCategory); }
      if (event.key === 'Escape') { event.preventDefault(); closeCategorySuggestions(); }
    });
    categoryList.addEventListener('pointerdown', function (event) {
      var option = event.target.closest('[data-category-index]');
      if (!option) return;
      event.preventDefault();
      chooseCategory(Number(option.dataset.categoryIndex));
    });

    var photoInput = document.getElementById('product-photo');
    var photoDrop = document.getElementById('product-photo-drop');
    var photoStatus = document.getElementById('product-photo-status');

    async function selectProductPhoto(file) {
      var allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
      photoStatus.classList.remove('error', 'success');
      if (!file || allowedTypes.indexOf(file.type) === -1) {
        selectedPhotoFile = null;
        photoInput.value = '';
        photoStatus.textContent = 'Choose a JPEG, PNG or WebP image.';
        photoStatus.classList.add('error');
        return toast('Choose a JPEG, PNG or WebP image.');
      }
      if (file.size > 500000) {
        selectedPhotoFile = null;
        photoInput.value = '';
        photoStatus.textContent = 'Image is larger than the 500 KB limit.';
        photoStatus.classList.add('error');
        return toast('Choose a product photo no larger than 500 KB.');
      }
      selectedPhotoFile = file;
      photoStatus.textContent = file.name + ' is ready to upload.';
      photoStatus.classList.add('success');
      try {
        var src = await imageToDataUrl(file);
        document.getElementById('product-preview').innerHTML = '<img src="' + esc(src) + '" alt="Product preview">';
      } catch (error) {
        selectedPhotoFile = null;
        photoStatus.textContent = 'The image preview could not be loaded.';
        photoStatus.classList.remove('success');
        photoStatus.classList.add('error');
        toast('The image preview could not be loaded.');
      }
    }

    document.getElementById('browse-product-photo').addEventListener('click', function () { photoInput.click(); });
    photoDrop.addEventListener('keydown', function (event) {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); photoInput.click(); }
    });
    photoInput.addEventListener('change', function () { if (photoInput.files[0]) selectProductPhoto(photoInput.files[0]); });
    ['dragenter', 'dragover'].forEach(function (name) { photoDrop.addEventListener(name, function (event) { event.preventDefault(); photoDrop.classList.add('drag-active'); }); });
    ['dragleave', 'drop'].forEach(function (name) { photoDrop.addEventListener(name, function (event) { event.preventDefault(); photoDrop.classList.remove('drag-active'); }); });
    photoDrop.addEventListener('drop', function (event) { if (event.dataTransfer.files[0]) selectProductPhoto(event.dataTransfer.files[0]); });

    document.getElementById('product-form').addEventListener('submit', async function (event) {
      event.preventDefault();
      var data = new FormData(event.target);
      var price = Number(data.get('price'));
      var stock = Number(data.get('stock'));
      var minimumOrderQuantity = Number(data.get('minimumOrderQuantity'));
      if (!Number.isFinite(price) || price < 0) return toast('Enter a valid product price.');
      if (!Number.isInteger(stock) || stock < 0) return toast('Enter a whole stock quantity of 0 or more.');
      if (!Number.isInteger(minimumOrderQuantity) || minimumOrderQuantity < 1) return toast('Minimum order quantity must be a positive whole number.');
      var productIdValue = product ? product.id : crypto.randomUUID();
      var photo = product ? product.photo : '';
      var submitButton = event.target.querySelector('button[type="submit"]');
      submitButton.disabled = true;
      submitButton.textContent = 'Saving…';
      try {
        var category = await findOrCreateCategory(data.get('category'));
        if (selectedPhotoFile) {
          photoStatus.textContent = 'Uploading image…';
          photoStatus.classList.remove('success', 'error');
          photo = await uploadProductImage(productIdValue, selectedPhotoFile);
        }
        var values = { id: productIdValue, name: String(data.get('name')).trim(), category_id: category.id, price: price, stock_quantity: stock, unit: data.get('unit'), minimum_order_quantity: minimumOrderQuantity, image_url: photo || null, is_active: product ? !product.deleted : true };
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

  function renderDatabaseProductExport() {
    var categories = state.categories.slice().sort(function (a, b) { return a.name.localeCompare(b.name); });
    modal('<form id="product-export-form"><div class="modal-head"><div><p class="eyebrow">Excel export</p><h2>Export products</h2></div><button class="icon-btn" id="close-modal" type="button">x</button></div><p class="subtext">Download a new .xlsx file based on the YDG product template. Product photos and units are included.</p><label class="field">Category<select name="category"><option value="">All Categories</option>' + categories.map(function (category) { return '<option value="' + category.id + '">' + esc(category.name) + '</option>'; }).join('') + '</select></label><fieldset class="export-choice"><legend>Products to include</legend><label><input type="radio" name="activity" value="active" checked> Active products only</label><label><input type="radio" name="activity" value="all"> Include inactive products</label></fieldset><p class="export-status" id="product-export-status" aria-live="polite">Choose the export options, then download the workbook.</p><div class="two-button"><button class="secondary" id="cancel-product-export" type="button">Cancel</button><button class="primary" id="download-product-export" type="submit">Download .xlsx</button></div></form>');
    document.getElementById('cancel-product-export').addEventListener('click', closeModal);
    document.getElementById('product-export-form').addEventListener('submit', async function (event) {
      event.preventDefault();
      var data = new FormData(event.currentTarget);
      var categoryId = data.get('category');
      var category = categories.find(function (entry) { return String(entry.id) === String(categoryId); });
      var includeInactive = data.get('activity') === 'all';
      var button = document.getElementById('download-product-export');
      var status = document.getElementById('product-export-status');
      button.disabled = true;
      button.textContent = 'Generating...';
      status.className = 'export-status loading';
      status.textContent = 'Loading matching products from the database...';
      try {
        var rows = await productCatalogueService.listAll({ visibility: includeInactive ? 'all' : 'active', categoryId: categoryId });
        var products = rows.map(mapDatabaseProduct);
        if (!products.length) {
          status.className = 'export-status error';
          status.textContent = 'No products match the selected export options.';
          button.textContent = 'Try again';
          return;
        }
        var result = await window.ProductExportService.exportProducts({
          products: products,
          category: category ? category.name : 'All Categories',
          onStatus: function (message) { status.textContent = message; }
        });
        status.className = 'export-status success';
        status.textContent = result.count + ' product(s) exported successfully. Download started.';
        button.textContent = 'Download again';
        toast('Product Excel download started.');
      } catch (error) {
        status.className = 'export-status error';
        status.textContent = error.message || 'The Excel file could not be generated.';
        button.textContent = 'Try again';
      } finally {
        button.disabled = false;
      }
    });
  }

  async function reactivateProduct(productId) {
    var product = getProduct(productId);
    if (!product || !product.deleted) return;
    var result = await supabaseClient.from('products').update({ is_active: true }).eq('id', product.id);
    if (result.error) return toast(result.error.message || 'The product could not be reactivated.');
    await refreshCataloguePage(product.name + ' is active again.');
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

  function renderDatabaseCategoryAdjust() {
    var categories = state.categories.filter(function (category) { return category.is_active !== false; }).slice().sort(function (a, b) { return a.name.localeCompare(b.name); });
    modal('<form id="category-form"><div class="modal-head"><div><p class="eyebrow">Pricing tool</p><h2>Adjust category prices</h2></div><button class="icon-btn" id="close-modal" type="button">x</button></div><p class="subtext">Update every active product in one category with one protected database operation.</p><label class="field">Category<select name="categoryId" required>' + categories.map(function (category) { return '<option value="' + category.id + '">' + esc(category.name) + '</option>'; }).join('') + '</select></label><label class="field">Percentage change<input name="percentage" type="number" min="-100" max="10000" step="0.01" required placeholder="Example: 10 or -5"></label><p class="photo-help">10 increases by 10%. -5 reduces by 5%. Prices are rounded to the nearest 50 MMK.</p><p class="export-status" id="category-adjust-status" aria-live="polite"></p><div class="two-button"><button class="primary" id="apply-category-adjust" type="submit">Apply price change</button></div></form>');
    document.getElementById('category-form').addEventListener('submit', async function (event) {
      event.preventDefault();
      var data = new FormData(event.currentTarget);
      var percentage = Number(data.get('percentage'));
      if (!Number.isFinite(percentage) || percentage < -100 || percentage > 10000) return toast('Enter a valid percentage from -100 to 10000.');
      var button = document.getElementById('apply-category-adjust');
      var status = document.getElementById('category-adjust-status');
      button.disabled = true;
      status.textContent = 'Updating category prices...';
      try {
        var result = await supabaseClient.rpc('adjust_product_category_prices', { p_category_id: data.get('categoryId'), p_percentage: percentage });
        if (result.error) throw result.error;
        await refreshCataloguePage(Number(result.data || 0) + ' product price(s) updated.');
      } catch (error) {
        button.disabled = false;
        status.className = 'export-status error';
        status.textContent = error.message || 'Category prices could not be updated.';
      }
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
    var label = role === 'staff' ? 'Staff' : 'Customer';
    modal('<form id="account-form"><div class="modal-head"><div><p class="eyebrow">Secure access control</p><h2>Create ' + label.toLowerCase() + ' account</h2></div><button class="icon-btn" id="close-modal" type="button">×</button></div><p class="subtext">Share the username and temporary password securely. The password is sent directly to the protected server function and is never saved in this browser.</p><div class="form-grid"><label class="field full-field">Full name<input name="fullName" required maxlength="100" autocomplete="off"></label><label class="field">Username<input name="username" required minlength="3" maxlength="32" pattern="[a-z0-9][a-z0-9._-]{1,30}[a-z0-9]" autocapitalize="none" spellcheck="false" autocomplete="off"></label><label class="field">Temporary password<input name="password" type="password" required minlength="6" autocomplete="new-password"></label><label class="field full-field">Confirm password<input name="confirmPassword" type="password" required minlength="6" autocomplete="new-password"></label></div><p class="photo-help">Minimum 6 characters. Longer passwords are safer.</p><div class="two-button"><button class="primary" type="submit">Create account</button></div></form>');
    document.getElementById('account-form').addEventListener('submit', async function (event) {
      event.preventDefault();
      var data = new FormData(event.target);
      if (data.get('password') !== data.get('confirmPassword')) return toast('The passwords do not match.');
      var button = event.target.querySelector('button[type="submit"]');
      button.disabled = true;
      button.textContent = 'Creating…';
      try {
        await accountService.create({ role: role, fullName: data.get('fullName'), username: data.get('username'), password: data.get('password') });
        await loadManagedAccounts();
        closeModal();
        renderAdminPage();
        toast(label + ' account created.');
      } catch (error) {
        toast(error.message || 'Account could not be created.');
        button.disabled = false;
        button.textContent = 'Create account';
      }
    });
  }

  async function updateAccountAccess(userId) {
    var account = state.users.find(function (entry) { return String(entry.id) === String(userId); });
    if (!account) return;
    try {
      await accountService.setActive(account.id, account.status !== 'Active');
      await loadManagedAccounts();
      renderAdminPage();
      toast('Account access updated.');
    } catch (error) { toast(error.message || 'Account access could not be updated.'); }
  }

  function renderPasswordResetForm(userId) {
    var account = state.users.find(function (entry) { return String(entry.id) === String(userId); });
    if (!account) return;
    modal('<form id="managed-password-form"><div class="modal-head"><div><p class="eyebrow">Owner-managed reset</p><h2>Reset ' + esc(account.username) + ' password</h2></div><button class="icon-btn" id="close-modal" type="button">×</button></div><p class="subtext">The customer or staff member cannot recover this password by email. Give the new password to them securely.</p><label class="field">New password<input name="password" type="password" required minlength="6" autocomplete="new-password"></label><label class="field">Confirm password<input name="confirmPassword" type="password" required minlength="6" autocomplete="new-password"></label><p class="photo-help">Minimum 6 characters. Longer passwords are safer.</p><div class="two-button"><button class="primary" type="submit">Reset password</button></div></form>');
    document.getElementById('managed-password-form').addEventListener('submit', async function (event) {
      event.preventDefault();
      var data = new FormData(event.target);
      if (data.get('password') !== data.get('confirmPassword')) return toast('The passwords do not match.');
      var button = event.target.querySelector('button[type="submit"]');
      button.disabled = true;
      button.textContent = 'Resetting…';
      try {
        await accountService.resetPassword(account.id, data.get('password'));
        closeModal();
        toast('Password reset completed.');
      } catch (error) {
        toast(error.message || 'Password could not be reset.');
        button.disabled = false;
        button.textContent = 'Reset password';
      }
    });
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
    var rows = order.items.map(function (item) {
      var product = getProduct(item.productId);
      var quantityIndicator = currentUser.role === 'customer' && item.confirmedQuantity !== item.quantity ? '<br><small>Shop adjusted quantity from ' + item.quantity + ' to ' + item.confirmedQuantity + '</small>' : '';
      return '<tr><td>' + esc(product ? product.name : item.productName) + '</td><td>' + visibleQuantity(order, item) + quantityIndicator + '</td><td>' + money(visibleUnitPrice(order, item)) + '</td><td>' + money(visibleLineTotal(order, item)) + '</td></tr>';
    }).join('');
    modal('<div class="modal-head no-print"><div><p class="eyebrow">Order voucher</p><h2>' + esc(order.orderNumber || order.id) + '</h2></div><button class="icon-btn" id="close-modal">×</button></div><section class="voucher" style="--voucher-accent:' + esc(voucher.accentColor) + '"><div class="voucher-top"><div><div class="voucher-brand">Yadanar Theingi</div><div class="voucher-shop">Stationery & Fancy</div></div><div class="voucher-order"><b>' + esc(voucher.title) + '</b><span>' + esc(order.orderNumber || order.id) + '</span></div></div><div class="voucher-details"><div><span>Customer</span><b>' + esc(order.customer) + '</b><small>' + esc(order.phone || 'Phone not recorded') + '</small></div><div><span>Status</span>' + badge(order.status) + '<small>' + order.date + '</small></div></div><div class="voucher-address"><span>Delivery address</span><b>' + esc(order.address || 'Address not recorded') + '</b>' + (order.busStation ? '<small>Bus station: ' + esc(order.busStation) + '</small>' : '') + '</div><div class="table-wrap"><table><thead><tr><th>Item</th><th>Qty</th><th>Unit price</th><th>Line total</th></tr></thead><tbody>' + rows + '</tbody></table></div><div class="cart-total"><span>' + (usesConfirmedValues(order) ? 'Final payable total' : 'Original order total') + '</span><b>' + money(visibleOrderTotal(order)) + '</b></div>' + (order.proofOfDelivery ? '<div class="voucher-proof"><span>Proof of delivery</span><img src="' + esc(order.proofOfDelivery) + '" alt="Proof of delivery"></div>' : '') + '<p class="voucher-footer">' + esc(voucher.footer) + '</p></section><div class="two-button no-print"><button class="primary" id="print-voucher">Print voucher</button></div>');
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
        await loadRemoteOrders();
        if (currentUser.role === 'owner') await loadManagedAccounts();
        return renderAdmin();
      }
      if (currentUser.role === 'customer') {
        if (state.settings.maintenanceMode) throw new Error('Customer ordering is temporarily under maintenance.');
        await loadCatalogueData();
        await loadRemoteOrders();
        await migrateLegacyCartOnce();
        return renderCustomer();
      }
      throw new Error('This account does not have access to the application.');
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

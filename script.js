(function() {
  const hamburgerBtn = document.getElementById('hamburgerBtn');
  const closehamburger = document.getElementById('closehamburger');
  const mobilePanel = document.getElementById('mobilePanel');
  const menuOverlay = document.getElementById('menuOverlay');
  const mobileNavLinks = document.querySelectorAll('.mobile-nav-link');
  const accountBox = document.getElementById('account');
  const openAccountDesktop = document.getElementById('openAccountDesktop');
  const openAccountMobile = document.getElementById('openAccountMobile');
  const quitaccount = document.getElementById('quitaccount');
  const quitaccountlogin = document.getElementById('quitaccountlogin');
  const signupForm = document.getElementById('signup');
  const loginForm = document.getElementById('login');
  const openlogin = document.getElementById('openlogin');
  const opensignup = document.getElementById('opensignup');

  function openMenu() {
    hamburgerBtn.classList.add('active');
    mobilePanel.classList.add('open');
    menuOverlay.classList.add('show');
    document.body.style.overflow = 'hidden';
  }

  function closeMenu() {
    hamburgerBtn.classList.remove('active');
    mobilePanel.classList.remove('open');
    menuOverlay.classList.remove('show');
    document.body.style.overflow = '';
  }

  hamburgerBtn.addEventListener('click', function(e) {
    e.stopPropagation();
    if (mobilePanel.classList.contains('open')) {
      closeMenu();
    } else {
      openMenu();
    }
  });

  menuOverlay.addEventListener('click', closeMenu);

  mobileNavLinks.forEach(link => {
    link.addEventListener('click', function(e) {
      closeMenu();
    });
  });

  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && mobilePanel.classList.contains('open')) {
      closeMenu();
    }
  });

  window.addEventListener('resize', function() {
    if (window.innerWidth > 850 && mobilePanel.classList.contains('open')) {
      closeMenu();
    }
  });

  function showAccountModal() {
    if (accountBox) {
      accountBox.style.display = 'flex';
    }
  }

  function hideAccountModal() {
    if (accountBox) {
      accountBox.style.display = 'none';
    }
  }

  if (openAccountDesktop) {
    openAccountDesktop.addEventListener('click', function(e) {
      e.preventDefault();
      showAccountModal();
    });
  }

  if (openAccountMobile) {
    openAccountMobile.addEventListener('click', function(e) {
      e.preventDefault();
      closeMenu();
      showAccountModal();
    });
  }

  if (quitaccount) quitaccount.addEventListener('click', hideAccountModal);
  if (quitaccountlogin) quitaccountlogin.addEventListener('click', hideAccountModal);

  if (openlogin) {
    openlogin.addEventListener('click', function() {
      if (loginForm) loginForm.style.display = 'flex';
      if (signupForm) signupForm.style.display = 'none';
    });
  }

  if (opensignup) {
    opensignup.addEventListener('click', function() {
      if (signupForm) signupForm.style.display = 'flex';
      if (loginForm) loginForm.style.display = 'none';
    });
  }

  const cartCount = document.getElementById('cartCount');
  if (cartCount) cartCount.textContent = '0';

  if (mobilePanel) {
    mobilePanel.addEventListener('click', function(e) {
      e.stopPropagation();
    });
  }

})();
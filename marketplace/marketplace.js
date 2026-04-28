  // Cart counter
  const cartCount = document.getElementById('cartCount');
  document.querySelectorAll('.add-cart-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      cartCount.textContent = parseInt(cartCount.textContent) + 1;
    });
  });

  // Newsletter submit
  document.getElementById('subBtn').addEventListener('click', () => {
    const input = document.querySelector('.newsletter-input');
    if (input.value.trim()) {
      document.querySelector('.newsletter-form').innerHTML =
        '<p style="color:#fff;font-size:1rem;font-weight:500;">✓ Subscribed! Check your inbox.</p>';
    }
  });
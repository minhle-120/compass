// Theme Manager for Compass Frontend
(function() {
  const savedTheme = localStorage.getItem('theme');
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const theme = savedTheme || (prefersDark ? 'dark' : 'light');
  document.documentElement.setAttribute('data-theme', theme);
})();

document.addEventListener('DOMContentLoaded', () => {
  const toggleBtn = document.getElementById('theme-toggle');
  if (!toggleBtn) return;

  function updateToggleIcon(theme) {
    const iconSpan = toggleBtn.querySelector('.theme-toggle-icon') || toggleBtn;
    const switchToLight = theme === 'dark';
    iconSpan.textContent = switchToLight ? '☀' : '☾';
    toggleBtn.setAttribute('aria-label', switchToLight ? 'Switch to light mode' : 'Switch to dark mode');
    toggleBtn.title = switchToLight ? 'Light mode' : 'Dark mode';
  }

  const currentTheme = document.documentElement.getAttribute('data-theme') || 'light';
  updateToggleIcon(currentTheme);

  toggleBtn.addEventListener('click', () => {
    const activeTheme = document.documentElement.getAttribute('data-theme') || 'light';
    const newTheme = activeTheme === 'light' ? 'dark' : 'light';
    
    document.documentElement.setAttribute('data-theme', newTheme);
    localStorage.setItem('theme', newTheme);
    updateToggleIcon(newTheme);
  });
});

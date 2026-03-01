
document.addEventListener('DOMContentLoaded', () => {
  const tThreads = document.getElementById('toggle-threads');
  const tInsta = document.getElementById('toggle-instagram');

  // Load saved settings (Default true)
  chrome.storage.sync.get(['enableThreads', 'enableInstagram'], (items) => {
    tThreads.checked = items.enableThreads !== false; 
    tInsta.checked = items.enableInstagram !== false; 
  });

  // Save on change
  const update = () => {
    const settings = {
      enableThreads: tThreads.checked,
      enableInstagram: tInsta.checked
    };
    chrome.storage.sync.set(settings, () => {
      // Notify active tabs
      chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
        if(tabs[0]?.id) {
            chrome.tabs.sendMessage(tabs[0].id, { type: 'SETTINGS_UPDATE', settings });
        }
      });
    });
  };

  tThreads.addEventListener('change', update);
  tInsta.addEventListener('change', update);
});

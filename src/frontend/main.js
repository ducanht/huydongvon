// ==========================================
// MAIN.JS - Vite SPA Entry Point
// ==========================================

// Mock google.script.run for local development (Vite Dev Server proxy)
if (typeof google === 'undefined') {
  console.log('[Dev Mode] Registering google.script.run API mock proxy...');
  
  window.google = {
    script: {
      run: {
        _successHandler: null,
        _failureHandler: null,
        
        withSuccessHandler: function(callback) {
          this._successHandler = callback;
          return this;
        },
        
        withFailureHandler: function(callback) {
          this._failureHandler = callback;
          return this;
        },
        
        doApiRequest: function(action, payload) {
          const self = this;
          console.log(`[Dev API Request] Action: ${action}`, payload);
          
          fetch('/api/data', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ action: action, payload: payload })
          })
          .then(res => {
            if (!res.ok) {
              throw new Error(`HTTP error! status: ${res.status}`);
            }
            return res.json();
          })
          .then(data => {
            // Apps Script doApiRequest returns a JSON string, so we mimic that structure.
            // On Apps Script: return JSON.stringify({ status: 'success', data: result })
            // If our doPost handles it: it will send back JSON string.
            if (self._successHandler) {
              if (typeof data === 'string') {
                self._successHandler(data);
              } else {
                self._successHandler(JSON.stringify(data));
              }
            }
          })
          .catch(err => {
            console.error(`[Dev API Error] Action: ${action} failed:`, err);
            if (self._failureHandler) {
              self._failureHandler(err);
            }
          });
        }
      }
    }
  };
}

// Import core application scripts (will expose window.AppManager & window.showToast)
import './assets/js/app.js';

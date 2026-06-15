// ==========================================
// MAIN.JS - Vite SPA Entry Point
// ==========================================

// Mock google.script.run for local development (Vite Dev Server proxy)
if (typeof google === 'undefined') {
  console.log('[Dev Mode] Registering google.script.run API mock proxy...');
  
  function createRunner(successCb, failureCb) {
    return {
      _successHandler: successCb,
      _failureHandler: failureCb,
      withSuccessHandler: function(callback) {
        return createRunner(callback, this._failureHandler);
      },
      withFailureHandler: function(callback) {
        return createRunner(this._successHandler, callback);
      },
      doApiRequest: function(action, payload) {
        const success = this._successHandler;
        const failure = this._failureHandler;
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
          if (success) {
            if (typeof data === 'string') {
              success(data);
            } else {
              success(JSON.stringify(data));
            }
          }
        })
        .catch(err => {
          console.error(`[Dev API Error] Action: ${action} failed:`, err);
          if (failure) {
            failure(err);
          }
        });
      }
    };
  }

  window.google = {
    script: {
      run: createRunner(null, null)
    }
  };
}

// Import core application scripts (will expose window.AppManager & window.showToast)
import './assets/js/app.js';

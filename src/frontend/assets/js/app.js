  /* ==========================================
       APP.JS - Lõi chức năng Frontend (SPA Routing, Ajax Helper)
       ========================================== */

  var AppManager = {
    // Client-side cache for static API data (e.g. dropdown lists)
    _clientCache: {},

    // Cấu hình ngôn ngữ tiếng Việt DataTables
    _DT_LANG_VI: {
      sProcessing: "Đang xử lý...",
      sLengthMenu: "Xem _MENU_ mục",
      sZeroRecords: "Không tìm thấy dòng nào phù hợp",
      sInfo: "Đang xem _START_ đến _END_ trong tổng số _TOTAL_ mục",
      sInfoEmpty: "Đang xem 0 đến 0 trong tổng số 0 mục",
      sInfoFiltered: "(được lọc từ _MAX_ mục)",
      sInfoPostFix: "",
      sSearch: "Tìm kiếm:",
      sUrl: "",
      oPaginate: {
        sFirst: "Đầu",
        sPrevious: "&laquo;",
        sNext: "&raquo;",
        sLast: "Cuối",
      },
    },
    // Múi giờ Việt Nam
    _VN_TIMEZONE: "Asia/Ho_Chi_Minh",

    // Format ngày dd/MM/yyyy theo giờ VN
    formatDate: function (d) {
      if (!d) return "";
      try {
        var dt = d instanceof Date ? d : new Date(d);
        if (isNaN(dt.getTime())) return String(d);
        return dt.toLocaleDateString("vi-VN", {
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
          timeZone: this._VN_TIMEZONE,
        });
      } catch (e) {
        return String(d);
      }
    },

    // Format ngày giờ dd/MM/yyyy HH:mm theo giờ VN
    formatDateTime: function (d) {
      if (!d) return "";
      try {
        var dt = d instanceof Date ? d : new Date(d);
        if (isNaN(dt.getTime())) return String(d);
        return dt.toLocaleString("vi-VN", {
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
          timeZone: this._VN_TIMEZONE,
          hour12: false,
        });
      } catch (e) {
        return String(d);
      }
    },

    // Format Tên Chiến Dịch chuẩn xác (tự động khử chuỗi ngày ISO)
    formatTenCD: function (tenCD, maCD, ngayBatDau) {
      if (!tenCD || tenCD === "undefined" || tenCD === "null") {
        if (ngayBatDau) {
          var dt = new Date(ngayBatDau);
          if (!isNaN(dt.getTime())) return "Chiến Dịch Tháng " + (dt.getMonth() + 1) + "/" + dt.getFullYear();
        }
        return maCD ? ("Chiến Dịch " + maCD) : "Chiến Dịch";
      }
      var s = String(tenCD).trim();
      if (s.indexOf('T00:00:00') !== -1 || /^\d{4}-\d{2}-\d{2}/.test(s)) {
        var dt2 = new Date(s);
        if (!isNaN(dt2.getTime())) {
          return "Chiến Dịch Tháng " + (dt2.getMonth() + 1) + "/" + dt2.getFullYear();
        }
      }
      return s;
    },

    init: function () {
      // Cấu hình ngôn ngữ tiếng Việt mặc định cho toàn bộ lịch Flatpickr
      if (typeof flatpickr !== "undefined" && flatpickr.l10ns && flatpickr.l10ns.vn) {
        flatpickr.localize(flatpickr.l10ns.vn);
      }

      // Lấy IP Public thực tế của người dùng từ dịch vụ bên thứ 3 (để ghi LOG Kiểm toán)
      $.getJSON('https://api.ipify.org?format=json')
        .done(function (data) {
          window.APP_CONTEXT.ClientIP = data.ip;
        })
        .fail(function () {
          window.APP_CONTEXT.ClientIP = "Unknown IP";
        });
      // Check session
      var token = localStorage.getItem("SESSIONTOKEN");
      if (!token) {
        // Not logged in -> Load Login Page, keep sidebar hidden
        $("#sidebar, #header").addClass("d-none");
        $("#mainWrapper").removeClass("app-main-wrapper").addClass("bg-light");
        this.loadPage("frmLogin");
        return;
      }

      // Has token -> Try to get profile
      AppManager.callApi("getUserProfile")
        .done(function (user) {
          window.APP_CONTEXT.User = user;
          AppManager.user = user;

          // Show shell
          $("#sidebar, #header").removeClass("d-none");
          $("#mainWrapper")
            .addClass("app-main-wrapper")
            .removeClass("bg-light");

          // Update Header
          $("#lblHeaderName").text(user.HoTen);
          $("#lblHeaderRole").text(user.Role);
          $("#lblHeaderAvatar").text(user.HoTen.charAt(0).toUpperCase());
          $("#lblSidebarBrandName").text(user.HoTen);

          if (user.RequirePasswordChange) {
            $("#sidebar, #header").addClass("d-none");
            $("#mainWrapper")
              .removeClass("app-main-wrapper")
              .addClass("bg-light");

            var modalEl = document.getElementById("modalDoiMatKhau");
            if (modalEl) {
              $(modalEl).find(".btn-close").addClass("d-none");
              $(modalEl).find("#btnCancelPass").addClass("d-none");
              $(modalEl).find("#btnForceLogout").removeClass("d-none");
              var bsModal = new bootstrap.Modal(modalEl, {
                backdrop: "static",
                keyboard: false,
              });
              bsModal.show();
              frmDoiMatKhau_init();
            }
            return; // Block loading dashboard
          }

          // Load Pending count for badge (ADMIN sees all, TELLER sees own)
          var _lastBadgeFetch = 0;
          AppManager.updatePendingBadge = function (force) {
            // Adaptive Polling: Bỏ qua nếu tab đang ẩn và không phải lệnh gọi cưỡng bức
            if (!force && document.hidden) return;
            var now = Date.now();
            if (!force && now - _lastBadgeFetch < 30000) return; // Chống spam trong vòng 30s
            _lastBadgeFetch = now;

            AppManager.callApi("getPendingCount").done(function (count) {
              if (count > 0) {
                $("#badgePendingCount").text(count).removeClass("d-none");
              } else {
                $("#badgePendingCount").addClass("d-none");
              }
            });
          };
          AppManager.updatePendingBadge(true);

          // Tự động kiểm tra lại khi người dùng quay lại tab (sau tối thiểu 60s)
          document.addEventListener("visibilitychange", function () {
            if (!document.hidden && Date.now() - _lastBadgeFetch > 60000) {
              AppManager.updatePendingBadge(true);
            }
          });

          // Tần suất Polling nền thông minh: 5 phút/lần (tiết kiệm 60% quota GAS)
          setInterval(function () {
            AppManager.updatePendingBadge(false);
          }, 5 * 60 * 1000);

          // Apply Role-based UI
          if (user.Role === window.APP_CONTEXT.Roles.ADMIN) {
            $(".admin-only").removeClass("d-none");
          } else {
            $(".admin-only").addClass("d-none");
          }

          // Khởi tạo autoNumeric defaults (nếu dùng chung)
          if (typeof AutoNumeric !== "undefined") {
            AutoNumeric.multiple(".input-currency", {
              digitGroupSeparator: ",",
              decimalCharacter: ".",
              decimalPlaces: 0,
              unformatOnSubmit: true,
            });
          }

          // Khởi tạo mặc định DataTables
          if ($.fn.dataTable) {
            $.extend(true, $.fn.dataTable.defaults, {
              language: AppManager._DT_LANG_VI,
              responsive: false, // Tắt hoàn toàn để không xung đột với CSS Cards mobile
            });
          }

          // Cập nhật default DataTables extend button
          if ($.fn.dataTable) {
            $.extend(true, $.fn.dataTable.defaults, {
              buttons: [
                {
                  extend: 'pdfHtml5',
                  exportOptions: { columns: ':visible' }
                }
              ]
            });

            // [INTERCEPTOR] Thay đổi hành động xuất file để lấy Toàn Bộ Dữ Liệu
            if ($.fn.dataTable.ext && $.fn.dataTable.ext.buttons) {
              var oldExportExcel = $.fn.dataTable.ext.buttons.excelHtml5.action;
              var oldExportPdf = $.fn.dataTable.ext.buttons.pdfHtml5.action;

              var fullExportAction = function (e, dt, button, config, originalAction) {
                var self = this;

                // [FIX] Nếu Table KHÔNG dùng AJAX (Dữ liệu Local như frmBaoCao), xuất file ngay lập tức
                if (!dt.ajax || !dt.ajax.url()) {
                  if (originalAction) originalAction.call(self, e, dt, button, config);
                  return;
                }

                var oldStart = dt.settings()[0]._iDisplayStart;
                var oldLength = dt.settings()[0]._iDisplayLength;

                AppManager.showToast('info', 'Đang tải toàn bộ ' + dt.page.info().recordsTotal + ' bản ghi để xuất file... Xin vui lòng chờ.');

                dt.one('preXhr', function (e, s, data) {
                  data.start = 0;
                  data.length = -1; // Yêu cầu Backend trả full dữ liệu lọc (-1)

                  dt.one('preDraw', function (e, settings) {
                    // Gọi hàm xuất file nguyên thủy ngay sau khi có Full Data
                    if (originalAction) originalAction.call(self, e, dt, button, config);

                    dt.one('preXhr', function (e, s, data) {
                      // Trả lại trang cũ trước khi tải lại màn hình
                      settings._iDisplayStart = oldStart;
                      data.start = oldStart;
                      data.length = oldLength;
                    });

                    setTimeout(dt.ajax.reload, 0); // Kích hoạt Render lại HTML như cũ
                    return false; // Chặn DataTable in hàng nghìn rows vào HTML
                  });
                });

                dt.ajax.reload(); // API Grap Full Data lần 1
              };

              // Ghi đè Global Export Action
              if (oldExportExcel) {
                $.fn.dataTable.ext.buttons.excelHtml5.action = function (e, dt, button, config) {
                  fullExportAction.call(this, e, dt, button, config, oldExportExcel);
                };
              }
              if (oldExportPdf) {
                $.fn.dataTable.ext.buttons.pdfHtml5.action = function (e, dt, button, config) {
                  fullExportAction.call(this, e, dt, button, config, oldExportPdf);
                };
              }
            }
          }

          // Load Dashboard
          AppManager.loadPage("frmDashboard");

          // Bind Events
          AppManager.bindEvents();

          // [L4] Session timeout: Lấy timestamp từ localStorage (nếu có) thay vì Date.now()
          var loginTime =
            parseInt(localStorage.getItem("LOGIN_TIMESTAMP") || "0") ||
            Date.now();
          if (!localStorage.getItem("LOGIN_TIMESTAMP")) {
            localStorage.setItem("LOGIN_TIMESTAMP", String(loginTime)); // Lưu lại khi khởi đầu
          }

          var SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 giờ
          var WARNING_BEFORE_MS = 30 * 60 * 1000; // Cảnh báo trước 30 phút

          var sessionCheckInterval = setInterval(
            function () {
              var elapsed = Date.now() - loginTime;
              var remaining = SESSION_TTL_MS - elapsed;

              if (remaining <= 0) {
                clearInterval(sessionCheckInterval);
                AppManager.showToast(
                  "error",
                  "Phiên làm việc đã hết hạn. Đang đăng xuất...",
                );
                setTimeout(function () {
                  AppManager.logout();
                }, 2000);
              } else if (remaining <= WARNING_BEFORE_MS) {
                var mins = Math.floor(remaining / 60000);
                AppManager.showToast(
                  "warning",
                  "⚠️ Phiên làm việc sắp hết hạn sau " + mins + " phút!",
                );
              }
            },
            10 * 60 * 1000,
          ); // Kiểm tra mỗi 10 phút

          // Gắn active menu dựa trên URL hiện tại (nếu có routing History API sau này)
          $('#mainMenu .nav-link[data-page="frmDashboard"]').addClass(
            "nav-state-active",
          );
        })
        .fail(function (err) {
          // Token invalid or expired
          AppManager.logout();
        });
    },

    /**
     * Hiển thị thông báo nhỏ ở góc màn hình (Toast)
     * @param {string} icon - 'success', 'error', 'warning', 'info'
     * @param {string} title - Tiêu đề thông báo
     */
    showToast: function (icon, title) {
      const Toast = Swal.mixin({
        toast: true,
        position: "top-end",
        showConfirmButton: false,
        timer: 3000,
        timerProgressBar: true,
        didOpen: (toast) => {
          toast.addEventListener("mouseenter", Swal.stopTimer);
          toast.addEventListener("mouseleave", Swal.resumeTimer);
        },
      });

      Toast.fire({
        icon: icon,
        title: title,
      });
    },

    /**
     * Nạp thư viện bên ngoài theo nhu cầu (On-demand Lazy Loading)
     * @param {string} url - Đường dẫn CDN của thư viện
     * @param {function} callback - Hàm thực thi sau khi nạp xong
     */
    loadScript: function (url, callback) {
      window._loadedScripts = window._loadedScripts || {};
      if (window._loadedScripts[url]) {
        if (typeof callback === "function") callback();
        return;
      }
      var script = document.createElement("script");
      script.type = "text/javascript";
      script.src = url;
      script.onload = function () {
        window._loadedScripts[url] = true;
        if (typeof callback === "function") callback();
      };
      script.onerror = function () {
        console.error("Lỗi nạp thư viện từ CDN: " + url);
      };
      document.head.appendChild(script);
    },

    bindEvents: function () {
      var self = this;

      // Cập nhật: Đóng sidebar khi bấm Overlay hoặc nút X
      $(document)
        .off("click", "#sidebarOverlay, #btnCloseSidebar")
        .on("click", "#sidebarOverlay, #btnCloseSidebar", function (e) {
          e.preventDefault();
          e.stopPropagation();
          $("#sidebar").removeClass("show");
          $("#sidebarOverlay").removeClass("show");
        });

      // Toggle Sidebar trên Mobile (Sử dụng Event Delegation để dứt điểm chạm trên màn hình)
      $(document)
        .off("click", "#btnToggleSideBar")
        .on("click", "#btnToggleSideBar", function (e) {
          e.preventDefault();
          e.stopPropagation();
          $("#sidebar").toggleClass("show");
          $("#sidebarOverlay").toggleClass("show");
        });

      // Click Menu Navigation
      $(document)
        .off("click", ".sidebar-nav .nav-link")
        .on("click", ".sidebar-nav .nav-link", function (e) {
          if (!$(this).data("page")) return;
          e.preventDefault();
          var page = $(this).data("page");

          if (page) {
            // Cập nhật active class menu
            $(".sidebar-nav .nav-link").removeClass("nav-state-active");
            $(this).addClass("nav-state-active");

            // Đóng sidebar tự động nếu đang dùng trên mobile/tablet
            if ($(window).width() <= 991) {
              $("#sidebar").removeClass("show");
              $("#sidebarOverlay").removeClass("show");
            }

            self.loadPage(page);
          }
        });
    },

    /**
     * Tải nội dung trang (Lazy Load SPA)
     */
    loadPage: function (pageId, data) {
      window.PAGE_PARAMS = data || null;
      var tplTarget = $("#tpl-" + pageId);
      window.HTML_MODULE_CACHE = window.HTML_MODULE_CACHE || {};

      // ─── TỐI ƯU HÓA HIỆU NĂNG: GIẢI PHÓNG BỘ NHỚ TRANG CŨ ───
      // 1. Giải phóng Chart.js toàn cục để tránh rò rỉ bộ nhớ ngầm
      var globalChartKeys = [
        'chartGiaoDichInstance', 'chartTyTrongInstance', 'chartThanhVienInstance',
        'chartEmpTimelineInstance', 'chartKyHanInstance', 'chartEmpTimelineModal',
        'chartKyHanModal'
      ];
      globalChartKeys.forEach(function(key) {
        if (window[key] && typeof window[key].destroy === 'function') {
          try {
            window[key].destroy();
          } catch(e) { console.warn("Lỗi destroy chart: " + key, e); }
          window[key] = null;
        }
      });

      // 2. Giải phóng Flatpickr trên các phần tử sắp bị xóa khỏi DOM
      $("#appContent").find(".flatpickr-input").each(function() {
        if (this._flatpickr) {
          try {
            this._flatpickr.destroy();
          } catch(e) {}
        }
      });

      // 3. Giải phóng Select2 trên các phần tử sắp bị xóa
      $("#appContent").find(".select2-hidden-accessible").each(function() {
        try {
          $(this).select2('destroy');
        } catch(e) {}
      });

      // 4. Giải phóng DataTable cũ để giải phóng RAM
      if ($.fn.DataTable) {
        $("#appContent").find("table").each(function() {
          if ($.fn.DataTable.isDataTable(this)) {
            try {
              $(this).DataTable().destroy(true);
            } catch(e) {}
          }
        });
      }

      // Hiển thị Loader
      $("#appContent").html(
        '<div class="text-center mt-5"><div class="spinner-border text-primary" role="status"></div><p class="mt-2 text-muted">Đang tải phân hệ...</p></div>',
      );

      var executeRender = function (htmlContent) {
        // Sử dụng requestAnimationFrame hoặc setTimeout 0 để đảm bảo DOM được cập nhật
        setTimeout(function () {
          $("#appContent").html(htmlContent);

          // Đợi thêm một nhịp nhỏ để các thẻ <script> bên trong được thực thi
          setTimeout(function () {
            var initFn = window[pageId + "_init"];
            if (typeof initFn === "function") {
              try {
                initFn(data);
              } catch (e) {
                console.error("Error in initFn for " + pageId, e);
                AppManager.showToast(
                  "error",
                  "Lỗi khởi tạo trang: " + e.message,
                );
              }
            } else {
              console.warn("No init function found for " + pageId);
            }
          }, 50);
        }, 0);
      };

      if (tplTarget.length > 0 && tplTarget.html().trim() !== "") {
        executeRender(tplTarget.html());
      } else if (
        pageId === "frmLogin" &&
        $("#html-templates #tpl-frmLogin").length > 0
      ) {
        // Ưu tiên nạp Login từ template tĩnh nếu có sẵn
        executeRender($("#html-templates #tpl-frmLogin").html());
      } else if (window.HTML_MODULE_CACHE[pageId]) {
        executeRender(window.HTML_MODULE_CACHE[pageId]);
      } else {
        AppManager.callApi("getHtmlModule", { moduleName: pageId })
          .done(function (res) {
            if (res && res.html) {
              window.HTML_MODULE_CACHE[pageId] = res.html;
              executeRender(res.html);
            } else {
              $("#appContent").html(
                '<div class="alert alert-danger m-4">Lỗi tải dữ liệu phân hệ.</div>',
              );
            }
          })
          .fail(function (err) {
            $("#appContent").html(
              '<div class="alert alert-danger m-4">Lỗi: ' + err + "</div>",
            );
          });
      }
    },

    // Cấu hình ngôn ngữ DataTables VN (Nhúng trực tiếp để không phụ thuộc CDN)
    _DT_LANG_VI: {
      sProcessing: "Đang xử lý...",
      sLengthMenu: "Xem _MENU_ mục",
      sZeroRecords: "Không tìm thấy dòng nào phù hợp",
      sInfo: "Đang xem _START_ đến _END_ trong tổng số _TOTAL_ mục",
      sInfoEmpty: "Đang xem 0 đến 0 trong tổng số 0 mục",
      sInfoFiltered: "(được lọc từ _MAX_ mục)",
      sSearch: "Tìm kiếm:",
      oPaginate: {
        sFirst: "Đầu",
        sPrevious: "Trước",
        sNext: "Tiếp",
        sLast: "Cuối",
      },
      buttons: {
        copy: "Sao chép",
        print: "In",
      },
    },

    /**
     * Helper gọi API Server (google.script.run)
     * Trả về jQuery Deferred (Promise)
     */
    _pendingActions: {},
    callApi: function (action, payload) {
      var cacheKey = action + (payload ? JSON.stringify(payload) : "");
      var cacheableActions = [
        'getAllChienDich', 'getChienDichActive', 
        'getNhanSuActive', 'getAllNhanSu', 
        'getKhachHangActive', 'getUserProfile', 'getCauHinhSystem'
      ];
      var now = Date.now();
      if (cacheableActions.indexOf(action) !== -1 && this._clientCache[cacheKey]) {
        var cachedEntry = this._clientCache[cacheKey];
        // Client cache TTL 5 phút (300.000 ms)
        if (cachedEntry && cachedEntry.expiresAt > now) {
          var dCached = $.Deferred();
          return dCached.resolve(JSON.parse(JSON.stringify(cachedEntry.data))).promise();
        } else {
          delete this._clientCache[cacheKey];
        }
      }

      var d = $.Deferred();

      // Intercept all API calls except allowed ones if password change is required
      if (this.user && this.user.RequirePasswordChange) {
        var allowedActions = [
          "getUserProfile",
          "changePassword",
          "logout",
          "clearSessionToken",
        ];
        if (allowedActions.indexOf(action) === -1) {
          $("#sidebar, #header").addClass("d-none");
          $("#mainWrapper")
            .removeClass("app-main-wrapper")
            .addClass("bg-light");
          var modalEl = document.getElementById("modalDoiMatKhau");
          if (modalEl) {
            $(modalEl).find(".btn-close").addClass("d-none");
            $(modalEl).find("#btnCancelPass").addClass("d-none");
            $(modalEl).find("#btnForceLogout").removeClass("d-none");
            try {
              var bsModal =
                bootstrap.Modal.getInstance(modalEl) ||
                new bootstrap.Modal(modalEl, {
                  backdrop: "static",
                  keyboard: false,
                });
              bsModal.show();
              if (typeof frmDoiMatKhau_init === "function")
                frmDoiMatKhau_init();
            } catch (e) {
              console.error(e);
            }
          }
          d.reject(
            "Bạn bắt buộc phải Đổi Mật Khẩu ở lần đăng nhập đầu tiên để tiếp tục sử dụng hệ thống.",
          );
          return d.promise();
        }
      }

      // [H9] CHỐNG BẤM LIÊN TIẾP & HIỆN LOADING
      var isWriteAction =
        /submit|save|duyet|huy|insert|update|delete|archive|clear/i.test(
          action,
        );
      var actionKey = action + (payload ? JSON.stringify(payload) : "");

      if (isWriteAction) {
        this._clientCache = {}; // Xóa sạch client-side cache khi có bất kỳ tác vụ ghi nào
        if (this._pendingActions[actionKey]) {
          console.warn(
            "[Double-Click Prevented] Action " +
            action +
            " is already pending.",
          );
          return d
            .reject("Yêu cầu đang được xử lý, vui lòng không bấm liên tiếp.")
            .promise();
        }
        this._pendingActions[actionKey] = true;
        this.showLoading(); // Hiện overlay toàn màn hình
      }

      payload = payload || {};
      if (action !== "login") {
        payload.token = localStorage.getItem("SESSIONTOKEN");
      }
      payload.ClientIP = window.APP_CONTEXT.ClientIP || "Unknown";

      var self = this;

      var handleResponse = function (resStr) {
        if (isWriteAction) {
          delete self._pendingActions[actionKey];
          self.hideLoading();
          // Tự động cập nhật lại số lượng pending badge ngay sau khi có tác vụ ghi
          if (typeof self.updatePendingBadge === "function") {
            setTimeout(function() { self.updatePendingBadge(true); }, 500);
          }
        }
        try {
          var json = typeof resStr === "string" ? JSON.parse(resStr) : resStr;
          if (json.status === "success") {
            if (cacheableActions.indexOf(action) !== -1) {
              self._clientCache[cacheKey] = {
                data: JSON.parse(JSON.stringify(json.data)),
                expiresAt: Date.now() + 5 * 60 * 1000 // 5 phút TTL
              };
            }
            d.resolve(json.data);
          } else {
            if (
              json.message === "TOKEN_EXPIRED" ||
              (json.message && json.message.indexOf("Token hết hạn") !== -1)
            ) {
              AppManager.logout();
              d.reject("Phiên đăng nhập hết hạn.");
            } else {
              d.reject(json.message || "Lỗi không xác định từ Server.");
            }
          }
        } catch (e) {
          console.error("API Parse Error", e, resStr);
          d.reject("Lỗi Parse JSON Data: " + e.message);
        }
      };

      var handleFailure = function (err) {
        if (isWriteAction) {
          delete self._pendingActions[actionKey];
          self.hideLoading();
        }
        var errMsg = (err && err.message) ? err.message : (typeof err === "string" ? err : "Lỗi Network/Server không xác định.");
        console.error("[API FAILURE]", action, errMsg);

        if (
          errMsg === "TOKEN_EXPIRED" ||
          errMsg.indexOf("Token hết hạn") !== -1
        ) {
          AppManager.logout();
          d.reject("Phiên đăng nhập hết hạn.");
        } else {
          d.reject(errMsg);
        }
      };

      // PATH 1: Môi trường Google Apps Script Web App
      if (typeof google !== "undefined" && google.script && google.script.run) {
        google.script.run
          .withSuccessHandler(handleResponse)
          .withFailureHandler(handleFailure)
          .doApiRequest(action, payload);
      } else {
        // PATH 2: Môi trường Vercel Web Proxy (/api/data)
        $.ajax({
          url: "/api/data",
          type: "POST",
          contentType: "application/json",
          data: JSON.stringify({ action: action, payload: payload }),
          dataType: "json",
          timeout: 25000,
        })
          .done(handleResponse)
          .fail(function (xhr, status, error) {
            var msg = (xhr.responseJSON && xhr.responseJSON.message) ? xhr.responseJSON.message : ("Lỗi máy chủ (" + status + "): " + error);
            handleFailure(new Error(msg));
          });
      }

      return d.promise();
    },

    logout: function () {
      var self = this;
      var token = localStorage.getItem("SESSIONTOKEN");

      // Hiển thị Loader chặn tương tác
      self.showLoading();

      var doLogout = function () {
        localStorage.removeItem("SESSIONTOKEN");
        localStorage.removeItem("USER_PROFILE");
        localStorage.removeItem("LOGIN_TIMESTAMP");
        window.APP_CONTEXT.User = null;
        window.HTML_MODULE_CACHE = {};

        // Ẩn loader và chuyển trang
        self.hideLoading();
        $("#sidebar, #header").addClass("d-none");
        $("#mainWrapper").removeClass("app-main-wrapper").addClass("bg-light");
        self.loadPage("frmLogin");

        self.showToast("info", "Bạn đã đăng xuất thành công.");
      };

      // Gọi API xóa session trên server trước khi xóa local
      if (token) {
        this.callApi("clearSessionToken", { token: token }).always(doLogout);
      } else {
        doLogout();
      }
    },

    /* ====================
           UI & FORMATTING HELPERS
           ==================== */

    /**
     * Định dạng tiền tệ VNĐ (Sử dụng thống nhất toàn app)
     */
    formatCurrency: function (amount) {
      if (amount === undefined || amount === null || isNaN(amount))
        return "0 đ";
      return (
        new Intl.NumberFormat("vi-VN", {
          style: "decimal",
          maximumFractionDigits: 0,
        }).format(amount) + " đ"
      );
    },

    // [M2] Bỏ các định nghĩa formatDate/formatDateTime trùng (lần 1 tại dòng 7-18)
    // Giữ lại lần 2 vì dạng chuỗi (dateString) được dùng nhiều hơn
    /**
     * Quản lý trạng thái Nút bấm (Loading)
     * @param {jQuery|string} btnSelector - Selector của nút
     * @param {boolean} isLoading - true để hiện loading, false để tắt
     * @param {string} [originalHtml] - Chuỗi HTML gốc (nếu false)
     * @param {string} [loadingText='Đang xử lý...'] - Chữ hiển thị khi loading
     *
     * @returns {string} Trả về HTML Gốc để user lưu trữ và gọi lại khi kết thúc
     */
    setBtnLoading: function (
      btnSelector,
      isLoading,
      originalHtml,
      loadingText,
    ) {
      var btn = $(btnSelector);
      loadingText = loadingText || "Đang xử lý...";

      if (isLoading) {
        var currentHtml = btn.html();
        btn
          .prop("disabled", true)
          .html('<i class="bx bx-loader-alt bx-spin"></i> ' + loadingText);
        return currentHtml; // Return để lưu lại
      } else {
        btn.prop("disabled", false).html(originalHtml);
      }
    },

    // [H5] Thêm showLoading / hideLoading (dùng bởi frmNhanSu và các form khác)
    showLoading: function () {
      if (!$("#appLoadingOverlay").length) {
        $("body").append(
          '<div id="appLoadingOverlay" style="position:fixed;top:0;left:0;width:100%;height:3px;background:rgba(16,185,129,0.15);z-index:99999;pointer-events:none;">' +
          '<div class="loading-bar-inner" style="width:0%;height:100%;background:#10b981;box-shadow:0 0 10px #10b981, 0 0 5px #10b981;transition:width 0.4s cubic-bezier(0.1, 0.8, 0.3, 1);"></div>' +
          '</div>'
        );
      }
      var overlay = $("#appLoadingOverlay");
      overlay.show();
      var inner = overlay.find(".loading-bar-inner");
      inner.css("width", "0%");
      if (inner.length) {
        var reflow = inner[0].offsetWidth; 
      }
      inner.css("width", "35%");
      
      if (this._loadingTimer) clearInterval(this._loadingTimer);
      this._loadingTimer = setInterval(function() {
        if (inner.length && inner[0].style && inner[0].style.width) {
          var w = parseFloat(inner[0].style.width);
          if (w < 85) {
            inner.css("width", (w + (90 - w) * 0.1) + "%");
          }
        }
      }, 300);
    },

    hideLoading: function () {
      if (this._loadingTimer) clearInterval(this._loadingTimer);
      var overlay = $("#appLoadingOverlay");
      var inner = overlay.find(".loading-bar-inner");
      if (inner.length) {
        inner.css("width", "100%");
        setTimeout(function() {
          overlay.fadeOut(150);
        }, 250);
      } else {
        overlay.hide();
      }
    },

  };

  function showToast(icon, message) {
    const Toast = Swal.mixin({
      toast: true,
      position: "top-end",
      showConfirmButton: false,
      timer: 3000,
      timerProgressBar: true,
    });
    Toast.fire({
      icon: icon, // 'success', 'error', 'warning', 'info'
      title: message,
    });
  }

  // Expose to global window scope for inline script access
  window.AppManager = AppManager;
  window.showToast = showToast;

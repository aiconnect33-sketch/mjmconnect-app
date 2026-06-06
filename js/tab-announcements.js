// ── tab-announcements.js — Announcements tab + Home banner ──

async function loadAnnouncements() {
  if (window.location.protocol === 'file:') return;
  try {
    var data = await sbGet('announcements', 'limit=200');
    if (!data) return;

    var now   = Date.now();
    var cut7  = new Date(now - 7  * 24 * 60 * 60 * 1000);
    var cut14 = new Date(now - 14 * 24 * 60 * 60 * 1000);

    // Banner: all announcements within 7 days
    var bannerItems = data.filter(function(a){ return new Date(a.created_at) >= cut7; });

    // Tab: all announcements within 14 days
    var tabItems = data.filter(function(a){ return new Date(a.created_at) >= cut14; });

    // ── RENDER BANNER ──
    var bannerEl = document.getElementById('home-ann-banner');
    if (bannerEl) {
      if (bannerItems.length) {
        bannerEl.innerHTML = bannerItems.map(function(a) {
          var d = new Date(a.created_at).toLocaleDateString('en-MY', { day:'numeric', month:'short', year:'numeric' });
          var t = new Date(a.created_at).toLocaleTimeString('en-MY', { hour:'numeric', minute:'2-digit', hour12:true });
          return '<div class="alert-banner" style="margin-bottom:6px;">'
            + '<i class="ti ti-alert-circle"></i>'
            + '<div class="alert-text">'
            + '<div style="font-weight:700;">' + escHtml(a.title) + '</div>'
            + '<div>' + escHtml(a.body) + '</div>'
            + '<div style="font-size:10px;opacity:0.7;margin-top:2px;">' + d + ' · ' + t + '</div>'
            + '</div></div>';
        }).join('');
        bannerEl.style.display = 'block';
      } else {
        bannerEl.style.display = 'none';
      }
    }

    // ── RENDER ANNOUNCEMENT TAB ──
    var tabEl = document.getElementById('ann-tab-list');
    if (tabEl) {
      if (!tabItems.length) {
        tabEl.innerHTML = '<div style="font-size:12px;color:var(--text-secondary);text-align:center;padding:14px 0;">No announcements.</div>';
        return;
      }
      var html = '';
      tabItems.forEach(function(ann) {
        var d = new Date(ann.created_at).toLocaleDateString('en-MY', { day:'numeric', month:'short', year:'numeric' });
        var t = new Date(ann.created_at).toLocaleTimeString('en-MY', { hour:'numeric', minute:'2-digit', hour12:true });
        html += '<div class="card card-info" style="margin-bottom:10px;">'
          + '<div class="card-meta">'
          + '<span class="card-time">' + d + ' · ' + t + '</span>'
          + '</div>'
          + '<div class="card-title">' + escHtml(ann.title) + '</div>'
          + '<div class="card-body">'  + escHtml(ann.body)  + '</div>'
          + '</div>';
      });
      tabEl.innerHTML = html;
    }
  } catch(e) {}
}

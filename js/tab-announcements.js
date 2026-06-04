// ── tab-announcements.js — Announcements tab ──

async function loadAnnouncements() {
  try {
    var data = await sbGet('announcements', 'limit=20');
    if (!data || data.length === 0) return;
    var badgeMap = {
      urgent:   'badge-urgent',
      general:  'badge-info',
      hr:       'badge-blue',
      facility: 'badge-amber',
      event:    'badge-blue'
    };
    var container = document.getElementById('screen-announce');
    if (!container) return;
    var html = '';
    data.forEach(function(ann) {
      var bCls    = badgeMap[ann.badge] || 'badge-info';
      var label   = ann.badge ? ann.badge.charAt(0).toUpperCase() + ann.badge.slice(1) : 'General';
      var cardCls = ann.badge === 'urgent' ? 'card-urgent' : 'card-info';
      var d       = new Date(ann.created_at).toLocaleDateString('en-MY', { day:'numeric', month:'short' });
      html += '<div class="card ' + cardCls + '">'
        + '<div class="card-meta"><span class="badge ' + bCls + '">' + escHtml(label) + '</span>'
        + '<span class="card-time">' + d + '</span></div>'
        + '<div class="card-title">' + escHtml(ann.title) + '</div>'
        + '<div class="card-body">'  + escHtml(ann.body)  + '</div>'
        + '</div>';
    });
    container.insertAdjacentHTML('afterbegin', html);
  } catch(e) {}
}

// ── tab-events.js — Staff Event tab ──

async function loadStaffEvents() {
  var el = document.getElementById('staff-event-list');
  if (!el) return;
  if (window.location.protocol === 'file:') {
    el.innerHTML = '<div style="font-size:12px;color:var(--text-secondary);text-align:center;padding:14px 0;">No events.</div>';
    return;
  }
  var today = new Date().toISOString().split('T')[0];
  el.innerHTML = '<div style="font-size:12px;color:var(--text-secondary);text-align:center;padding:14px 0;">Loading...</div>';
  try {
    var url = SURL + '/rest/v1/events?event_date=gte.' + today + '&order=event_date.asc,event_time.asc&limit=200';
    var res  = await fetch(url, { headers: { 'apikey': SKEY, 'Authorization': 'Bearer ' + SKEY } });
    var data = await res.json();
    if (!data || !data.length) {
      el.innerHTML = '<div style="font-size:12px;color:var(--text-secondary);text-align:center;padding:14px 0;">No upcoming events.</div>';
      return;
    }
    el.innerHTML = data.map(function(ev) {
      var d = new Date(ev.event_date + 'T00:00:00').toLocaleDateString('en-MY',{day:'numeric',month:'short',year:'numeric'});
      var t = ev.event_time ? (function(s){ var p=s.split(':'),h=parseInt(p[0]),m=p[1],ap=h>=12?'PM':'AM'; h=h%12||12; return h+':'+m+' '+ap; })(ev.event_time) : '';
      return '<div class="card" style="margin-bottom:10px;border-left:3px solid #534AB7;border-radius:0 var(--radius-lg) var(--radius-lg) 0;">'
        + '<div class="card-meta">'
        + '<span style="font-size:10px;font-weight:600;padding:2px 7px;border-radius:10px;background:#EEEDFE;color:#534AB7;">Event</span>'
        + '<span class="card-time">' + d + (t ? ' · ' + t : '') + '</span>'
        + '</div>'
        + '<div class="card-title">' + escHtml(ev.title) + '</div>'
        + (ev.description ? '<div class="card-body">' + escHtml(ev.description) + '</div>' : '')
        + '</div>';
    }).join('');
  } catch(e) {
    el.innerHTML = '<div style="font-size:12px;color:var(--text-secondary);text-align:center;padding:14px 0;">Could not load events.</div>';
  }
}

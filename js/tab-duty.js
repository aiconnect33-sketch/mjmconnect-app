// ── tab-duty.js — Duty tab ──

async function loadDuty() {
  try {
    var data = await sbGet('duty_roster', 'limit=20');
    if (!data || data.length === 0) return;
    var container = document.getElementById('screen-duty');
    if (!container) return;
    var html = '<div class="roster-card"><div class="roster-title">Live Duty Assignments</div>';
    data.forEach(function(r) {
      var ini = r.staff_name.split(' ').filter(Boolean).slice(0,2)
                  .map(function(p){ return p[0].toUpperCase(); }).join('');
      html += '<div class="roster-row">'
        + '<div class="roster-person"><div class="av av-g">' + ini + '</div>'
        + '<div><div class="roster-name">' + escHtml(r.staff_name) + '</div>'
        + '<div class="roster-role">'      + escHtml(r.duty_role)  + '</div></div></div>'
        + '<div class="roster-day today">' + escHtml(r.period || 'Active') + '</div>'
        + '</div>';
    });
    html += '</div>';
    container.insertAdjacentHTML('afterbegin', html);
  } catch(e) {}
}

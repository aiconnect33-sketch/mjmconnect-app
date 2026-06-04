// ── tab-leave.js — Leave tab ──

async function loadLeave() {
  try {
    var data = await sbGet('leave_records', 'limit=20');
    if (!data || data.length === 0) return;
    var container = document.getElementById('screen-leave');
    if (!container) return;
    var html = '<div class="card"><div class="card-label">Live Leave Records</div>';
    data.forEach(function(r) {
      var ini = r.staff_name.split(' ').filter(Boolean).slice(0,2)
                  .map(function(p){ return p[0].toUpperCase(); }).join('');
      var shortType = r.leave_type === 'Annual Leave' ? 'AL'
                    : r.leave_type === 'Medical Leave' ? 'MC' : 'CL';
      var from = new Date(r.date_from + 'T00:00:00').toLocaleDateString('en-MY',{day:'numeric',month:'short'});
      var to   = new Date(r.date_to   + 'T00:00:00').toLocaleDateString('en-MY',{day:'numeric',month:'short'});
      html += '<div class="person-row">'
        + '<div class="av av-g">' + ini + '</div>'
        + '<div style="flex:1;"><div class="p-name">' + escHtml(r.staff_name) + '</div>'
        + '<div class="p-sub">' + escHtml(r.leave_type) + ' · ' + from + '–' + to + '</div></div>'
        + '<span class="badge badge-amber">' + shortType + '</span></div>';
    });
    html += '</div>';
    container.insertAdjacentHTML('afterbegin', html);
  } catch(e) {}
}

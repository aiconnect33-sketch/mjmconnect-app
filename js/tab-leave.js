// ── tab-leave.js — Leave tab + Home today on leave ──

async function loadLeave() {
  if (window.location.protocol === 'file:') return;
  var today = new Date().toISOString().split('T')[0];
  var avColors = ['av-green','av-amber','av-coral','av-blue','av-purple','av-red'];

  // ── HOME TAB: today on leave ──
  var homeEl = document.getElementById('home-leave-today');
  if (homeEl) {
    try {
      var url = SURL + '/rest/v1/leave_records?date_from=lte.' + today + '&date_to=gte.' + today + '&order=staff_name.asc&limit=20';
      var res  = await fetch(url, { headers: { 'apikey': SKEY, 'Authorization': 'Bearer ' + SKEY } });
      var data = await res.json();
      if (data && data.length) {
        var html = '<div class="card">';
        data.forEach(function(r, i) {
          var ini = r.staff_name.split(' ').filter(Boolean).slice(0,2).map(function(p){ return p[0].toUpperCase(); }).join('');
          var avCls = avColors[i % avColors.length];
          var shortType = r.leave_type === 'Annual Leave' ? 'AL' : r.leave_type === 'Medical Leave' ? 'MC' : 'CL';
          var badgeCls  = r.leave_type === 'Medical Leave' ? 'badge-urgent' : 'badge-amber';
          var from = new Date(r.date_from+'T00:00:00').toLocaleDateString('en-MY',{day:'numeric',month:'short'});
          var to   = new Date(r.date_to+'T00:00:00').toLocaleDateString('en-MY',{day:'numeric',month:'short'});
          html += '<div class="person-row">'
            + '<div class="avatar ' + avCls + '">' + ini + '</div>'
            + '<div style="flex:1;"><div class="person-name">' + escHtml(r.staff_name) + '</div>'
            + '<div class="person-sub">' + escHtml(r.leave_type) + ' · ' + from + (from !== to ? '–' + to : '') + '</div></div>'
            + '<span class="badge ' + badgeCls + '">' + shortType + '</span></div>';
        });
        html += '</div>';
        homeEl.innerHTML = html;
      } else {
        homeEl.innerHTML = '<div class="card"><div style="font-size:12px;color:var(--text-secondary);text-align:center;padding:8px 0;">No one on leave today.</div></div>';
      }
    } catch(e) {}
  }

  // ── LEAVE TAB: current + upcoming ──
  var tabEl = document.getElementById('leave-tab-list');
  if (tabEl) {
    try {
      var url2 = SURL + '/rest/v1/leave_records?date_to=gte.' + today + '&order=date_from.asc&limit=100';
      var res2 = await fetch(url2, { headers: { 'apikey': SKEY, 'Authorization': 'Bearer ' + SKEY } });
      var data2 = await res2.json();
      if (!data2 || !data2.length) {
        tabEl.innerHTML = '<div style="font-size:12px;color:var(--text-secondary);text-align:center;padding:14px 0;">No leave records.</div>';
        return;
      }
      var current  = data2.filter(function(r){ return r.date_from <= today && today <= r.date_to; });
      var upcoming = data2.filter(function(r){ return r.date_from > today; });
      var html2 = '';
      function renderGroup(title, items) {
        if (!items.length) return '';
        var h = '<div class="section-row"><div class="section-title">' + title + '</div></div><div class="card">';
        items.forEach(function(r, i) {
          var ini = r.staff_name.split(' ').filter(Boolean).slice(0,2).map(function(p){ return p[0].toUpperCase(); }).join('');
          var avCls = avColors[i % avColors.length];
          var shortType = r.leave_type === 'Annual Leave' ? 'AL' : r.leave_type === 'Medical Leave' ? 'MC' : 'CL';
          var badgeCls  = r.leave_type === 'Medical Leave' ? 'badge-urgent' : 'badge-amber';
          var from = new Date(r.date_from+'T00:00:00').toLocaleDateString('en-MY',{day:'numeric',month:'short'});
          var to   = new Date(r.date_to+'T00:00:00').toLocaleDateString('en-MY',{day:'numeric',month:'short'});
          h += '<div class="person-row">'
            + '<div class="avatar ' + avCls + '">' + ini + '</div>'
            + '<div style="flex:1;"><div class="person-name">' + escHtml(r.staff_name) + '</div>'
            + '<div class="person-sub">' + escHtml(r.leave_type) + ' · ' + from + (from !== to ? ' – ' + to : '') + '</div></div>'
            + '<span class="badge ' + badgeCls + '">' + shortType + '</span></div>';
        });
        h += '</div>';
        return h;
      }
      html2 += renderGroup('Currently on Leave', current);
      html2 += renderGroup('Upcoming Leave', upcoming);
      tabEl.innerHTML = html2;
    } catch(e) {
      tabEl.innerHTML = '<div style="font-size:12px;color:var(--text-secondary);text-align:center;padding:14px 0;">Could not load leave records.</div>';
    }
  }
}

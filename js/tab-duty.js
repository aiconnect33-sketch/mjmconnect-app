// ── tab-duty.js — Duty tab + Home duty section ──

async function loadDuty() {
  if (window.location.protocol === 'file:') return;
  var today = new Date().toISOString().split('T')[0];
  var avColors = ['av-green','av-amber','av-coral','av-blue','av-purple','av-red'];

  // ── HOME TAB: currently on duty only ──
  var homeEl = document.getElementById('home-duty-card');
  if (homeEl) {
    try {
      var url = SURL + '/rest/v1/duty_roster?date_from=lte.' + today + '&date_to=gte.' + today + '&order=duty_role.asc,staff_name.asc&limit=50';
      var res  = await fetch(url, { headers: { 'apikey': SKEY, 'Authorization': 'Bearer ' + SKEY } });
      var data = await res.json();
      if (data && data.length) {
        // Group by role
        var groups = {};
        data.forEach(function(r) {
          var role = r.duty_role || 'General Duty';
          if (!groups[role]) groups[role] = { members: [], date_from: r.date_from, date_to: r.date_to };
          groups[role].members.push(r);
        });
        var html = '';
        Object.keys(groups).forEach(function(role) {
          var g    = groups[role];
          var from = g.date_from ? new Date(g.date_from+'T00:00:00').toLocaleDateString('en-MY',{day:'numeric',month:'short'}) : '';
          var to   = g.date_to   ? new Date(g.date_to+'T00:00:00').toLocaleDateString('en-MY',{day:'numeric',month:'short'}) : '';
          var period = from === to ? from : from + ' – ' + to;
          html += '<div style="margin-bottom:10px;">'
            + '<div style="font-weight:600;font-size:12px;color:var(--text-primary);margin-bottom:2px;">' + escHtml(role) + '</div>'
            + '<div style="font-size:10px;color:var(--text-secondary);margin-bottom:6px;">' + period + '</div>';
          g.members.forEach(function(r, i) {
            var ini = r.staff_name.split(' ').filter(Boolean).slice(0,2).map(function(p){ return p[0].toUpperCase(); }).join('');
            html += '<div class="person-row" style="padding:4px 0;">'
              + '<div class="avatar av-green" style="font-size:10px;">' + ini + '</div>'
              + '<div style="flex:1;"><div class="person-name" style="font-size:12px;">' + escHtml(r.staff_name) + '</div></div>'
              + '<span class="badge badge-success">On duty</span></div>';
          });
          html += '</div>';
        });
        homeEl.innerHTML = '<div class="card">' + html + '</div>';
      } else {
        homeEl.innerHTML = '<div class="card"><div style="font-size:12px;color:var(--text-secondary);text-align:center;padding:8px 0;">No one on duty today.</div></div>';
      }
    } catch(e) {
      homeEl.innerHTML = '<div class="card"><div style="font-size:12px;color:var(--text-secondary);text-align:center;padding:8px 0;">Could not load duty.</div></div>';
    }
  }

  // ── DUTY TAB: upcoming + active, past auto-removed ──
  var tabEl = document.getElementById('duty-tab-list');
  if (tabEl) {
    try {
      var url2 = SURL + '/rest/v1/duty_roster?date_to=gte.' + today + '&order=date_from.asc,duty_role.asc&limit=200';
      var res2 = await fetch(url2, { headers: { 'apikey': SKEY, 'Authorization': 'Bearer ' + SKEY } });
      var data2 = await res2.json();
      if (!data2 || !data2.length) {
        tabEl.innerHTML = '<div style="font-size:12px;color:var(--text-secondary);text-align:center;padding:14px 0;">No upcoming duty assignments.</div>';
        return;
      }
      // Group by role + date range
      var groups2 = {};
      var groupOrder = [];
      data2.forEach(function(r) {
        var key = (r.duty_role || '') + '||' + (r.date_from || '') + '||' + (r.date_to || '');
        if (!groups2[key]) { groups2[key] = { role: r.duty_role, date_from: r.date_from, date_to: r.date_to, members: [] }; groupOrder.push(key); }
        groups2[key].members.push(r);
      });
      tabEl.innerHTML = groupOrder.map(function(key, gi) {
        var g = groups2[key];
        var from = g.date_from ? new Date(g.date_from+'T00:00:00').toLocaleDateString('en-MY',{day:'numeric',month:'short',year:'numeric'}) : '';
        var to   = g.date_to   ? new Date(g.date_to+'T00:00:00').toLocaleDateString('en-MY',{day:'numeric',month:'short',year:'numeric'}) : '';
        var dateLabel  = from === to ? from : from + ' – ' + to;
        var isActive   = g.date_from <= today && today <= (g.date_to || g.date_from);
        var badgeCls   = isActive ? 'badge-success' : 'badge badge-info';
        var badgeLabel = isActive ? 'Active' : 'Upcoming';
        return '<div class="card" style="margin-bottom:10px;">'
          + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">'
          + '<div style="font-size:12px;font-weight:600;color:var(--text-primary);">' + escHtml(g.role || 'General Duty') + '</div>'
          + '<span class="badge ' + badgeCls + '">' + badgeLabel + '</span></div>'
          + '<div style="font-size:11px;color:var(--text-secondary);margin-bottom:8px;">' + dateLabel + '</div>'
          + g.members.map(function(r, mi) {
            var ini    = r.staff_name.split(' ').filter(Boolean).slice(0,2).map(function(p){ return p[0].toUpperCase(); }).join('');
            var avCls  = avColors[(gi + mi) % avColors.length];
            return '<div class="person-row" style="padding:5px 0;">'
              + '<div class="avatar ' + avCls + '" style="font-size:10px;">' + ini + '</div>'
              + '<div style="flex:1;"><div class="person-name" style="font-size:12px;">' + escHtml(r.staff_name) + '</div></div>'
              + '<span class="badge ' + badgeCls + '">' + badgeLabel + '</span></div>';
          }).join('')
          + '</div>';
      }).join('');
    } catch(e) {
      tabEl.innerHTML = '<div style="font-size:12px;color:var(--text-secondary);text-align:center;padding:14px 0;">Could not load duty roster.</div>';
    }
  }
}

const me = requirePage(['Parent']);

const childIds = String(me.LinkedStudentIDs || '').split(',').filter(Boolean);
let subjects = [];

function subjectName(id) {
  const s = subjects.find(function (x) { return x.SubjectID === id; });
  return s ? s.SubjectName : id;
}

async function init() {
  subjects = await api('listSubjects', {}).catch(function () { return []; });
  if (!childIds.length) {
    document.querySelector('.container').insertAdjacentHTML('beforeend',
      "<div class=\"card muted\">No children are linked to your account yet. Contact the school admin to link your child's ID.</div>");
    return;
  }
  const select = document.getElementById('childSelect');
  for (const id of childIds) {
    const p = await api('getProfile', { userId: id }).catch(function () { return null; });
    const opt = document.createElement('option');
    opt.value = id; opt.textContent = p ? p.FullName : id;
    select.appendChild(opt);
  }
  select.addEventListener('change', function () { loadChild(this.value); });
  loadChild(select.value);
}
init();

async function loadChild(studentId) {
  if (!studentId) return;
  try {
    const data = await api('getChildData', { studentId: studentId });
    const balance = await api('getPaymentBalance', { studentId: studentId }).catch(function () { return null; });
    document.getElementById('childData').classList.remove('hidden');
    document.getElementById('childPhoto').src = data.profile.PhotoURL || 'https://placehold.co/110x110?text=Photo';
    document.getElementById('childName').textContent = data.profile.FullName;
    document.getElementById('childId').textContent = data.profile.UserID;
    const badge = document.getElementById('childPayBadge');
    const tierInfo = paymentTierBadge(data.paymentStatus);
    badge.textContent = 'Payment: ' + tierInfo.label;
    badge.className = 'badge ' + tierInfo.className;

    const balanceEl = document.getElementById('childBalanceInfo');
    if (balance && balance.fee > 0 && balance.remaining > 0) {
      const waText = encodeURIComponent('Hello JangAfrika, I would like to complete my child\'s tuition payment. Child: ' +
        data.profile.FullName + ' (ID: ' + studentId + '). Remaining balance: GMD ' + balance.remaining + '.');
      const mailSubject = encodeURIComponent('Complete tuition payment — ' + data.profile.FullName);
      const mailBody = encodeURIComponent('Hello,\n\nI would like to complete my child\'s tuition payment.\n\nChild: ' +
        data.profile.FullName + '\nStudent ID: ' + studentId + '\nRemaining balance: GMD ' + balance.remaining + '\n\nThank you.');
      balanceEl.innerHTML = '<div>Fee: <strong>GMD ' + balance.fee + '</strong> · Paid: <strong>GMD ' + balance.totalPaid +
        '</strong> · Remaining balance: <strong style="color:#b3261e;">GMD ' + balance.remaining + '</strong> (' + balance.percent + '% paid)</div>' +
        '<div class="no-print" style="margin-top:10px;">' +
        '<a class="btn" target="_blank" href="https://wa.me/2202630798?text=' + waText + '">💬 Complete Payment via WhatsApp</a> ' +
        '<a class="btn secondary" href="mailto:info.jangafrica@gmail.com?subject=' + mailSubject + '&body=' + mailBody + '">✉️ Email the school office</a></div>';
    } else {
      balanceEl.innerHTML = '';
    }

    const marksEmptyMsg = data.paymentStatus === 'Paid' ? 'No marks uploaded yet' : 'Locked until fees are fully paid';
    fillTable('marksBody', data.marks, function (m) {
      return [subjectName(m.SubjectID), m.Term, (m.AssignmentsAvg === '' ? '—' : m.AssignmentsAvg + '%'),
        (m.Test === '' ? '—' : m.Test + '%'), (m.Exam === '' ? '—' : m.Exam + '%'),
        (m.Score === '' ? '—' : m.Score + '%'), m.Grade];
    }, 7, marksEmptyMsg);

    fillTable('taskResultsBody', data.taskResults, function (r) {
      return [r.Score + '/' + r.MaxScore, r.Percentage + '%', r.PassStatus, r.Recommendation || '', fmtDate(r.DateTaken)];
    }, 5, marksEmptyMsg);

    fillTable('subjectsBody', data.subjectRegistrations || [], function (s) {
      return [subjectName(s.SubjectID), fmtDate(s.DateRegistered), s.Status];
    }, 3, 'No subjects registered yet');

    fillTable('topicsBody', data.topicRegistrations, function (t) {
      return [subjectName(t.SubjectID), t.TopicID, fmtDate(t.DateRegistered), t.Status];
    }, 4, 'No topics registered yet');

    fillTable('attendanceBody', data.attendance, function (a) {
      return [fmtDate(a.AttendanceDate), subjectName(a.SubjectID), a.Status, a.Comment || '—'];
    }, 4, 'No attendance recorded yet');

    fillTable('paymentsBody', data.payments, function (p) {
      return [p.Amount, p.Term, fmtDate(p.DatePaid), p.Status];
    }, 4, 'No payments yet');

  } catch (err) { toast(err.message, true); }
}

function fillTable(bodyId, rows, mapper, colspan, emptyMsg) {
  const body = document.getElementById(bodyId);
  body.innerHTML = rows.length ? '' : ('<tr><td colspan="' + colspan + '" class="muted">' + emptyMsg + '</td></tr>');
  rows.slice().reverse().forEach(function (r) {
    const tr = document.createElement('tr');
    tr.innerHTML = mapper(r).map(function (c) { return '<td>' + c + '</td>'; }).join('');
    body.appendChild(tr);
  });
}

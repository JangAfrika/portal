const me = requirePage(['Student']);

document.querySelectorAll('.tabs button').forEach(function (btn) {
  btn.addEventListener('click', function () {
    document.querySelectorAll('.tabs button').forEach(function (b) { b.classList.remove('active'); });
    document.querySelectorAll('.tabpane').forEach(function (p) { p.classList.add('hidden'); });
    btn.classList.add('active');
    document.getElementById('tab-' + btn.dataset.tab).classList.remove('hidden');
  });
});

let subjects = [], topics = [], myTier = 'Unpaid';

async function init() {
  const profile = await api('getProfile', {});
  myTier = profile.PaymentStatus || 'Unpaid';
  const balance = await api('getPaymentBalance', {}).catch(function () { return null; });
  renderPaymentBanner(myTier, balance);

  subjects = await api('listSubjects', {});
  const subjOpts = subjects.map(function (s) { return '<option value="' + s.SubjectID + '">' + s.SubjectName + '</option>'; }).join('');
  ['matSubjectFilter', 'asgSubjectFilter', 'regSubject', 'regSubjectClass'].forEach(function (id) { document.getElementById(id).innerHTML = subjOpts; });

  document.getElementById('matSubjectFilter').addEventListener('change', loadMaterials);
  document.getElementById('asgSubjectFilter').addEventListener('change', loadAssignments);
  document.getElementById('regSubject').addEventListener('change', loadTopicsForReg);

  await loadTopicsForReg();
  // These don't depend on each other — load together instead of one at a time.
  await Promise.all([
    safeCall(loadMaterials, 'materials'),
    safeCall(loadAssignments, 'assignments'),
    safeCall(loadMySubjects, 'registered subjects'),
    safeCall(loadMyTopics, 'registered topics'),
    safeCall(loadTasks, 'tasks'),
    safeCall(loadMyResults, 'task results'),
    safeCall(loadAssignedTaskTiles, 'assigned tasks'),
    safeCall(loadAttendance, 'attendance')
  ]);
  await loadSummary();
  if (myTier === 'Paid') await loadMarks();
  else document.getElementById('marksBody').innerHTML = '<tr><td colspan="7" class="muted">Locked until fees are fully paid.</td></tr>';
}
init();

/** Renders the payment status banner with a clear remaining-balance figure
 *  and a real "Complete Payment" action (contacts the school directly,
 *  since JangAfrika records payments in person / via bank / mobile money —
 *  there is no online payment gateway wired up). */
function renderPaymentBanner(tier, balance) {
  const banner = document.getElementById('paymentBanner');
  const badge = paymentTierBadge(tier);
  let bannerText, balanceHtml = '', actionHtml = '';

  if (tier === 'Paid') {
    bannerText = 'You have full access — marks, performance summary, and subject/topic registration are all unlocked.';
  } else if (tier === 'Partial') {
    bannerText = 'You can register for subjects and topics, but marks and your performance summary stay locked until fees are fully paid.';
  } else {
    bannerText = 'Registering for subjects/topics and viewing marks are locked until at least 50% of your fees are paid.';
  }

  if (balance && balance.fee > 0 && balance.remaining > 0) {
    balanceHtml = '<div style="margin-top:8px;">Fee: <strong>GMD ' + balance.fee + '</strong> · ' +
      'Paid: <strong>GMD ' + balance.totalPaid + '</strong> · ' +
      'Remaining balance: <strong style="color:#b3261e;">GMD ' + balance.remaining + '</strong> (' + balance.percent + '% paid)</div>';
    const waText = encodeURIComponent('Hello JangAfrika, I would like to complete my tuition payment. My name is ' +
      me.FullName + ' (ID: ' + me.UserID + '). Remaining balance: GMD ' + balance.remaining + '.');
    const mailSubject = encodeURIComponent('Complete tuition payment — ' + me.FullName);
    const mailBody = encodeURIComponent('Hello,\n\nI would like to complete my tuition payment.\n\nName: ' +
      me.FullName + '\nStudent ID: ' + me.UserID + '\nRemaining balance: GMD ' + balance.remaining + '\n\nThank you.');
    actionHtml = '<div class="no-print" style="margin-top:10px;">' +
      '<a class="btn" target="_blank" href="https://wa.me/2202630798?text=' + waText + '">💬 Complete Payment via WhatsApp</a> ' +
      '<a class="btn secondary" href="mailto:info.jangafrica@gmail.com?subject=' + mailSubject + '&body=' + mailBody + '">✉️ Email the school office</a>' +
      '</div>';
  }

  banner.innerHTML = '<span class="badge ' + badge.className + '">Payment: ' + badge.label + '</span> — ' + bannerText + balanceHtml + actionHtml;
}

async function loadTopicsForReg() {
  const subjectId = document.getElementById('regSubject').value;
  topics = subjectId ? await api('listTopics', { subjectId: subjectId }) : [];
  document.getElementById('regTopic').innerHTML = topics.map(function (t) { return '<option value="' + t.TopicID + '">' + t.TopicName + '</option>'; }).join('');
}

// ---- Summary tab -----------------------------------------------------------------
async function loadSummary() {
  const container = document.getElementById('summaryContent');
  if (myTier !== 'Paid') {
    container.innerHTML = '<p class="muted">Your performance summary unlocks once your fees are fully paid.</p>';
    return;
  }
  try {
    const rows = await api('getPerformanceSummary', {});
    if (!rows.length) { container.innerHTML = '<p class="muted">No registered subjects/topics with recorded performance yet.</p>'; return; }
    let html = '<table><thead><tr><th>Subject</th><th>Assessment avg</th><th>Topic tasks avg</th><th>Topics registered</th></tr></thead><tbody>';
    rows.forEach(function (r) {
      html += '<tr><td>' + r.subjectName + '</td>' +
        '<td>' + (r.assessmentAverage === null ? '—' : r.assessmentAverage + '%') + '</td>' +
        '<td>' + (r.taskAverage === null ? '—' : r.taskAverage + '%') + '</td>' +
        '<td>' + r.topicsRegistered + '</td></tr>';
    });
    html += '</tbody></table>';
    container.innerHTML = html;
  } catch (err) {
    container.innerHTML = '<p class="muted">' + err.message + '</p>';
  }
}

// ---- Subject (class) registration --------------------------------------------------
guardClick(document.getElementById('regSubjectBtn'), async function () {
  await api('registerSubject', { subjectId: document.getElementById('regSubjectClass').value });
  toast('Registered for subject'); await loadMySubjects(); await loadSummary();
});
async function loadMySubjects() {
  const rows = await api('listSubjectRegistrations', {});
  const body = document.getElementById('mySubjectsBody');
  body.innerHTML = rows.length ? '' : '<tr><td colspan="3" class="muted">No subjects registered yet</td></tr>';
  rows.forEach(function (r) {
    const subj = subjects.find(function (s) { return s.SubjectID === r.SubjectID; });
    const tr = document.createElement('tr');
    tr.innerHTML = '<td>' + (subj ? subj.SubjectName : r.SubjectID) + '</td><td>' + fmtDate(r.DateRegistered) + '</td><td>' + r.Status + '</td>';
    body.appendChild(tr);
  });
}

// ---- Topic registration -------------------------------------------------------------
guardClick(document.getElementById('regBtn'), async function () {
  await api('registerTopic', { subjectId: document.getElementById('regSubject').value, topicId: document.getElementById('regTopic').value });
  toast('Registered for topic'); await loadMyTopics(); await loadSummary();
});

async function loadMyTopics() {
  const rows = await api('listTopicRegistrations', {});
  const body = document.getElementById('myTopicsBody');
  body.innerHTML = rows.length ? '' : '<tr><td colspan="4" class="muted">No topics registered yet</td></tr>';
  rows.forEach(function (r) {
    const subj = subjects.find(function (s) { return s.SubjectID === r.SubjectID; });
    const tr = document.createElement('tr');
    tr.innerHTML = '<td>' + (subj ? subj.SubjectName : r.SubjectID) + '</td><td>' + r.TopicID + '</td>' +
      '<td>' + fmtDate(r.DateRegistered) + '</td><td>' + r.Status + '</td>';
    body.appendChild(tr);
  });
}

async function loadMaterials() {
  const subjectId = document.getElementById('matSubjectFilter').value;
  const rows = await api('listMaterials', { subjectId: subjectId });
  const body = document.getElementById('materialsBody');
  body.innerHTML = rows.length ? '' : '<tr><td colspan="4" class="muted">No materials yet</td></tr>';
  rows.forEach(function (m) {
    const tr = document.createElement('tr');
    tr.innerHTML = '<td>' + m.Title + '</td><td>' + (m.Description || '') + '</td>' +
      '<td>' + (m.FileURL ? ('<a href="' + m.FileURL + '" target="_blank">Download</a>') : '—') + '</td><td>' + fmtDate(m.DateUploaded) + '</td>';
    body.appendChild(tr);
  });
}

async function loadAssignments() {
  const subjectId = document.getElementById('asgSubjectFilter').value;
  const [rows, mySubs] = await Promise.all([
    api('listAssignments', { subjectId: subjectId }),
    api('listSubmissions', {})
  ]);
  const body = document.getElementById('assignmentsBody');
  body.innerHTML = rows.length ? '' : '<tr><td colspan="6" class="muted">No assignments yet</td></tr>';
  rows.forEach(function (a) {
    const submission = mySubs.find(function (s) { return s.AssignmentID === a.AssignmentID; });
    const tr = document.createElement('tr');
    tr.innerHTML = '<td>' + a.Title + '</td><td>' + fmtDate(a.DueDate) + '</td>' +
      '<td>' + (a.FileURL ? ('<a href="' + a.FileURL + '" target="_blank">Open</a>') : '—') + '</td><td></td><td></td><td></td>';
    const submitTd = tr.children[3], statusTd = tr.children[4], feedbackTd = tr.children[5];
    if (submission) {
      if (submission.Status === 'Graded') {
        statusTd.innerHTML = '<span class="badge active">Graded: ' + submission.Score + '/' + a.MaxScore + (submission.Grade ? (' (' + submission.Grade + ')') : '') + '</span>';
        feedbackTd.textContent = submission.Feedback || '—';
      } else {
        statusTd.innerHTML = '<span class="badge pending">Submitted</span>';
        feedbackTd.textContent = 'Not graded yet';
      }
      submitTd.textContent = '—';
    } else {
      const fileInput = document.createElement('input'); fileInput.type = 'file';
      const submitBtn = document.createElement('button'); submitBtn.textContent = 'Submit';
      guardClick(submitBtn, async function () {
        const file = fileInput.files[0];
        if (!file) { toast('Choose a file first', true); return; }
        const b64 = await fileToBase64(file);
        await api('submitAssignment', { assignmentId: a.AssignmentID, fileBase64: b64, fileName: file.name });
        toast('Submitted'); await loadAssignments();
      });
      submitTd.appendChild(fileInput); submitTd.appendChild(submitBtn);
      statusTd.innerHTML = '<span class="badge pending">Not submitted</span>';
      feedbackTd.textContent = '—';
    }
    body.appendChild(tr);
  });
}

let availableTaskList = [];

async function loadTasks() {
  const rows = await api('listTasks', {});
  availableTaskList = rows;
  const container = document.getElementById('tasksContainer');
  container.innerHTML = '';
  if (!rows.length) { container.innerHTML = '<p class="muted">No tasks available yet.</p>'; return; }
  rows.forEach(function (task, i) {
    const tile = document.createElement('button');
    tile.type = 'button';
    tile.className = 'task-tile';
    tile.innerHTML = '<div class="task-tile-num">Task ' + (i + 1) + '</div><div class="task-tile-title">' + task.Title + '</div>';
    tile.onclick = function () { openAvailableTask(i); };
    container.appendChild(tile);
  });
}

async function openAvailableTask(index) {
  const task = availableTaskList[index];
  if (!task) return;
  const questions = JSON.parse(task.QuestionsJSON);
  const area = document.getElementById('taskQuizArea');
  area.classList.remove('hidden');
  area.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  const wrap = document.createElement('div');
  wrap.className = 'card';
  wrap.style.background = '#f7faf8';
  wrap.innerHTML = '<h3>' + task.Title + '</h3>';
  questions.forEach(function (q, i) {
    const qDiv = document.createElement('div');
    qDiv.innerHTML = '<p><strong>' + (i + 1) + '. ' + q.q + '</strong></p>';
    q.choices.forEach(function (c, ci) {
      if (!c) return;
      const label = document.createElement('label');
      label.style.fontWeight = 'normal';
      label.innerHTML = '<input type="radio" name="task_' + task.TaskID + '_q' + i + '" value="' + ci + '"> ' + c;
      qDiv.appendChild(label);
    });
    wrap.appendChild(qDiv);
  });
  const submitBtn = document.createElement('button');
  submitBtn.textContent = 'Submit answers';
  guardClick(submitBtn, async function () {
    const answers = questions.map(function (q, i) {
      const checked = wrap.querySelector('input[name="task_' + task.TaskID + '_q' + i + '"]:checked');
      return checked ? Number(checked.value) : -1;
    });
    const result = await api('submitTask', { taskId: task.TaskID, answers: JSON.stringify(answers) });
    toast('Score: ' + result.Percentage + '% (' + result.PassStatus + ')');
    area.classList.add('hidden'); area.innerHTML = '';
    await loadMyResults(); await loadSummary();
  });
  const backBtn = document.createElement('button');
  backBtn.className = 'secondary';
  backBtn.style.marginLeft = '8px';
  backBtn.textContent = '← Back to tasks';
  backBtn.onclick = function () { area.classList.add('hidden'); area.innerHTML = ''; };

  wrap.appendChild(submitBtn);
  wrap.appendChild(backBtn);
  area.innerHTML = '';
  area.appendChild(wrap);
}

async function loadMyResults() {
  const [rows, tasks] = await Promise.all([
    api('listTaskResults', {}),
    api('listTasks', {}).catch(function () { return []; })
  ]);
  const body = document.getElementById('myResultsBody');
  body.innerHTML = rows.length ? '' : '<tr><td colspan="6" class="muted">No results yet</td></tr>';
  rows.slice().reverse().forEach(function (r) {
    const task = tasks.find(function (t) { return t.TaskID === r.TaskID; });
    const tr = document.createElement('tr');
    tr.innerHTML = '<td>' + (task ? task.Title : r.TaskID) + '</td>' +
      '<td>' + r.Score + '/' + r.MaxScore + '</td><td>' + r.Percentage + '%</td>' +
      '<td><span class="badge ' + (r.PassStatus === 'Pass' ? 'pass' : 'fail') + '">' + r.PassStatus + '</span></td>' +
      '<td class="muted">' + (r.Recommendation || '') + '</td><td>' + fmtDate(r.DateTaken) + '</td>';
    body.appendChild(tr);
  });
}

async function loadMarks() {
  const rows = await api('listMarks', {});
  const body = document.getElementById('marksBody');
  body.innerHTML = rows.length ? '' : '<tr><td colspan="7" class="muted">No marks uploaded yet</td></tr>';
  rows.forEach(function (m) {
    const subj = subjects.find(function (s) { return s.SubjectID === m.SubjectID; });
    const tr = document.createElement('tr');
    tr.innerHTML = '<td>' + (subj ? subj.SubjectName : m.SubjectID) + '</td><td>' + m.Term + '</td>' +
      '<td>' + (m.AssignmentsAvg === '' ? '—' : m.AssignmentsAvg + '%') + '</td>' +
      '<td>' + (m.Test === '' ? '—' : m.Test + '%') + '</td><td>' + (m.Exam === '' ? '—' : m.Exam + '%') + '</td>' +
      '<td>' + (m.Score === '' ? '—' : m.Score + '%') + '</td><td>' + m.Grade + '</td>';
    body.appendChild(tr);
  });
}

async function loadAttendance() {
  const rows = await api('listAttendance', {});
  const body = document.getElementById('attendanceBody');
  body.innerHTML = rows.length ? '' : '<tr><td colspan="3" class="muted">No attendance recorded yet</td></tr>';
  rows.slice().reverse().forEach(function (r) {
    const subj = subjects.find(function (s) { return s.SubjectID === r.SubjectID; });
    const tr = document.createElement('tr');
    tr.innerHTML = '<td>' + fmtDate(r.AttendanceDate) + '</td><td>' + (subj ? subj.SubjectName : r.SubjectID) + '</td><td>' + r.Status + '</td>';
    body.appendChild(tr);
  });
}

guardClick(document.getElementById('aiBtn'), async function () {
  const prompt = document.getElementById('aiPrompt').value.trim();
  if (!prompt) { toast('Type what you want to study', true); return; }
  const resultBox = document.getElementById('aiResult');
  resultBox.classList.remove('hidden');
  resultBox.textContent = 'Generating…';
  try {
    const rec = await api('generateStudyText', { prompt: prompt });
    resultBox.textContent = rec.GeneratedText;
  } catch (err) { resultBox.textContent = 'Error: ' + err.message; }
});

// ---- Assigned past-paper tasks: numbered tiles, click to open live inline --------
let assignedTaskList = [];

async function loadAssignedTaskTiles() {
  const [assignments, allPapers] = await Promise.all([
    api('listPastPaperAssignments', {}),
    api('listPastPapers', {})
  ]);
  const container = document.getElementById('assignedTaskTiles');
  if (!assignments.length) {
    container.innerHTML = '<p class="muted">Nothing assigned to you yet.</p>';
    return;
  }

  const attemptsPerAssignment = await Promise.all(assignments.map(function (a) {
    return a.TaskID ? api('getPastPaperAttempts', { paperId: a.PaperID }).catch(function () { return null; }) : Promise.resolve(null);
  }));

  assignedTaskList = assignments.map(function (a, i) {
    return { assignment: a, paper: allPapers.find(function (p) { return p.PaperID === a.PaperID; }), attempt: attemptsPerAssignment[i] };
  }).filter(function (t) { return t.paper; });

  container.innerHTML = '';
  assignedTaskList.forEach(function (t, i) {
    const done = t.attempt && t.attempt.latest;
    const tile = document.createElement('button');
    tile.type = 'button';
    tile.className = 'task-tile';
    tile.innerHTML = '<div class="task-tile-num">Task ' + (i + 1) + '</div>' +
      '<div class="task-tile-title">' + t.paper.Title + '</div>' +
      '<span class="badge ' + (done ? 'pass' : 'pending') + '">' +
      (t.paper.PaperType === 'Theory' ? 'Download' : (done ? done.Percentage + '%' : 'Not started')) + '</span>';
    tile.onclick = function () { openAssignedTask(i); };
    container.appendChild(tile);
  });
}

async function openAssignedTask(index) {
  const t = assignedTaskList[index];
  if (!t) return;
  if (t.paper.PaperType === 'Theory' || !t.paper.TaskID) {
    await downloadPastPaperPdf(t.paper.PaperID);
    return;
  }

  const area = document.getElementById('assignedTaskQuizArea');
  area.classList.remove('hidden');
  area.innerHTML = '<p class="muted">Loading…</p>';
  area.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  const task = await api('getTask', { taskId: t.paper.TaskID });
  const questions = JSON.parse(task.QuestionsJSON);

  const wrap = document.createElement('div');
  wrap.className = 'card';
  wrap.style.background = '#f7faf8';
  let headerHtml = '<h3>' + t.paper.Title + '</h3>';
  if (t.attempt && t.attempt.firstTry) {
    headerHtml += '<p class="muted">First try: ' + t.attempt.firstTry.Percentage + '% · Latest: ' + t.attempt.latest.Percentage + '%</p>';
  }
  wrap.innerHTML = headerHtml;

  questions.forEach(function (q, i) {
    const qDiv = document.createElement('div');
    qDiv.innerHTML = '<p><strong>' + (i + 1) + '. ' + q.q + '</strong></p>';
    q.choices.forEach(function (c, ci) {
      if (!c) return;
      const label = document.createElement('label');
      label.style.fontWeight = 'normal';
      label.innerHTML = '<input type="radio" name="assigned_' + task.TaskID + '_q' + i + '" value="' + ci + '"> ' + c;
      qDiv.appendChild(label);
    });
    wrap.appendChild(qDiv);
  });

  const submitBtn = document.createElement('button');
  submitBtn.textContent = 'Submit answers';
  guardClick(submitBtn, async function () {
    const answers = questions.map(function (q, i) {
      const checked = wrap.querySelector('input[name="assigned_' + task.TaskID + '_q' + i + '"]:checked');
      return checked ? Number(checked.value) : -1;
    });
    const result = await api('submitTask', { taskId: task.TaskID, answers: JSON.stringify(answers) });
    toast('Score: ' + result.Percentage + '% (' + result.PassStatus + ')');
    area.classList.add('hidden');
    await loadAssignedTaskTiles();
    await loadMyResults();
  });
  const backBtn = document.createElement('button');
  backBtn.className = 'secondary';
  backBtn.style.marginLeft = '8px';
  backBtn.textContent = '← Back to my tasks';
  backBtn.onclick = function () { area.classList.add('hidden'); area.innerHTML = ''; };

  wrap.appendChild(submitBtn);
  wrap.appendChild(backBtn);
  area.innerHTML = '';
  area.appendChild(wrap);
}

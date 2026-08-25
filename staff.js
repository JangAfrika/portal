const me = requirePage(['Staff', 'Admin']);

document.querySelectorAll('.tabs button').forEach(function (btn) {
  btn.addEventListener('click', function () {
    document.querySelectorAll('.tabs button').forEach(function (b) { b.classList.remove('active'); });
    document.querySelectorAll('.tabpane').forEach(function (p) { p.classList.add('hidden'); });
    btn.classList.add('active');
    document.getElementById('tab-' + btn.dataset.tab).classList.remove('hidden');
  });
});

let mySubjects = [], allTopics = [], myRoster = [];

/** Every student registered (subject- or topic-level) to any subject this
 *  teacher teaches, merged and de-duplicated. listUsers is Admin-only, so
 *  this is how teachers resolve StudentID -> name everywhere on this page
 *  instead of every table falling back to showing raw IDs. */
async function loadMyRoster() {
  const perSubject = await Promise.all(mySubjects.map(function (s) {
    return api('listRegisteredStudents', { subjectId: s.SubjectID }).catch(function () { return []; });
  }));
  const merged = [].concat.apply([], perSubject);
  const seen = {};
  myRoster = merged.filter(function (s) { return seen[s.UserID] ? false : (seen[s.UserID] = true); });
}

async function init() {
  const subjects = await api('listSubjects', {});
  // A teacher only sees subjects they're assigned to (Admin sees all).
  mySubjects = (me.Role === 'Admin') ? subjects : subjects.filter(function (s) {
    return String(s.TeacherIDs || '').split(',').indexOf(me.UserID) > -1;
  });
  const subjOpts = mySubjects.map(function (s) { return '<option value="' + s.SubjectID + '">' + s.SubjectName + '</option>'; }).join('');
  ['attSubject', 'attHistorySubject', 'matSubject', 'asgSubject', 'taskSubject', 'lpSubject', 'sylSubject', 'curSubject'].forEach(function (id) {
    document.getElementById(id).innerHTML = subjOpts;
  });
  document.getElementById('attHistorySubject').insertAdjacentHTML('afterbegin', '<option value="">All my subjects</option>');
  document.getElementById('attDate').value = new Date().toISOString().slice(0, 10);
  await loadTopicsFor(mySubjects[0] ? mySubjects[0].SubjectID : null);
  await loadMyRoster();
  // These six don't depend on each other, so load them together instead of
  // one at a time — much faster than a strictly serial chain of API calls.
  await Promise.all([
    safeCall(loadAttendanceRoster, 'attendance roster'),
    safeCall(loadAttendanceHistory, 'attendance history'),
    safeCall(loadAssignmentsForGrading, 'assignments'),
    safeCall(loadLessonPlans, 'lesson reports'),
    safeCall(loadTaskResults, 'task results'),
    safeCall(loadTemplates, 'templates'),
    safeCall(renderCurriculum, 'curriculum'),
    safeCall(loadLessonReportReviewStatus, 'lesson report status'),
    safeCall(initPastQuestionsAssign, 'past questions')
  ]);

  ['attSubject'].forEach(function (id) { document.getElementById(id).addEventListener('change', loadAttendanceRoster); });
  document.getElementById('attHistorySubject').addEventListener('change', loadAttendanceHistory);
  document.getElementById('curSubject').addEventListener('change', renderCurriculum);
  document.getElementById('matSubject').addEventListener('change', function () { fillTopicSelect('matTopic', this.value); });
  document.getElementById('asgSubject').addEventListener('change', function () { fillTopicSelect('asgTopic', this.value); });
  document.getElementById('taskSubject').addEventListener('change', function () { fillTopicSelect('taskTopic', this.value); });
  document.getElementById('lpSubject').addEventListener('change', function () { fillTopicSelect('lpTopic', this.value); loadTemplates(); });
  document.getElementById('lpTopic').addEventListener('change', function () { fillSubtopicSelect('lpSubtopic', this.value); });
  document.getElementById('sylSubject').addEventListener('change', function () { fillTopicSelect('sylTopic', this.value); loadTemplates(); });
}
init();

async function loadTopicsFor(subjectId) {
  allTopics = subjectId ? await api('listTopics', { subjectId: subjectId }) : [];
  ['matTopic', 'asgTopic', 'taskTopic', 'lpTopic', 'sylTopic'].forEach(function (id) { fillTopicSelect(id, subjectId); });
}
function fillTopicSelect(id, subjectId) {
  const topics = subjectId ? allTopics.filter(function (t) { return t.SubjectID === subjectId; }) : [];
  document.getElementById(id).innerHTML = '<option value="">—</option>' +
    topics.map(function (t) { return '<option value="' + t.TopicID + '">' + t.TopicName + '</option>'; }).join('');
}
async function fillSubtopicSelect(id, topicId) {
  const select = document.getElementById(id);
  select.innerHTML = '<option value="">Loading…</option>';
  const subtopics = topicId ? await api('listSubtopics', { topicId: topicId }) : [];
  select.innerHTML = '<option value="">—</option>' +
    subtopics.map(function (st) { return '<option value="' + st.SubtopicID + '">' + st.SubtopicName + '</option>'; }).join('');
}

// ---- Attendance -------------------------------------------------------------
// Roster is limited to students actually registered (subject- or topic-level)
// to the selected subject, so teachers only mark students in their class.
async function loadAttendanceRoster() {
  const tbody = document.querySelector('#attTable tbody');
  const subjectId = document.getElementById('attSubject').value;
  tbody.innerHTML = '<tr><td colspan="2" class="muted">Loading roster…</td></tr>';
  if (!subjectId) { tbody.innerHTML = '<tr><td colspan="2" class="muted">Choose a subject</td></tr>'; return; }
  const roster = await api('listRegisteredStudents', { subjectId: subjectId }).catch(function () { return []; });
  tbody.innerHTML = '';
  if (!roster.length) {
    tbody.innerHTML = '<tr><td colspan="2" class="muted">No students registered to this subject/topic yet.</td></tr>';
    return;
  }
  roster.forEach(function (s) {
    const tr = document.createElement('tr');
    tr.innerHTML = '<td>' + s.FullName + '</td><td></td>';
    const sel = document.createElement('select');
    sel.innerHTML = '<option>Present</option><option>Absent</option><option>Late</option>';
    sel.dataset.studentId = s.UserID;
    tr.lastElementChild.appendChild(sel);
    tbody.appendChild(tr);
  });
}
guardClick(document.getElementById('attSubmit'), async function () {
  const subjectId = document.getElementById('attSubject').value;
  const date = document.getElementById('attDate').value;
  if (!subjectId) { toast('Choose a subject', true); return; }
  const records = Array.from(document.querySelectorAll('#attTable select')).map(function (sel) {
    return { studentId: sel.dataset.studentId, subjectId: subjectId, status: sel.value, date: date };
  });
  if (!records.length) { toast('No students to mark', true); return; }
  await api('markAttendance', { records: JSON.stringify(records) });
  toast('Attendance saved');
  await loadAttendanceHistory();
});

async function loadAttendanceHistory() {
  const subjectId = document.getElementById('attHistorySubject').value;
  const body = document.getElementById('attHistoryBody');
  body.innerHTML = '<tr><td colspan="4" class="muted">Loading…</td></tr>';
  const subjectIds = subjectId ? [subjectId] : mySubjects.map(function (s) { return s.SubjectID; });
  const perSubject = await Promise.all(subjectIds.map(function (id) { return api('listAttendance', { subjectId: id }); }));
  const rows = [].concat.apply([], perSubject);
  body.innerHTML = rows.length ? '' : '<tr><td colspan="4" class="muted">No attendance recorded yet</td></tr>';
  rows.slice().reverse().forEach(function (r) {
    const student = myRoster.find(function (s) { return s.UserID === r.StudentID; });
    const subj = mySubjects.find(function (s) { return s.SubjectID === r.SubjectID; });
    const tr = document.createElement('tr');
    tr.innerHTML = '<td>' + fmtDate(r.AttendanceDate) + '</td><td>' + (student ? student.FullName : r.StudentID) + '</td>' +
      '<td>' + (subj ? subj.SubjectName : r.SubjectID) + '</td><td>' + r.Status + '</td>';
    body.appendChild(tr);
  });
}

// ---- Materials -----------------------------------------------------------------
guardSubmit(document.getElementById('materialForm'), async function () {
  const file = document.getElementById('matFile').files[0];
  const fileBase64 = file ? await fileToBase64(file) : '';
  await api('uploadMaterial', {
    subjectId: document.getElementById('matSubject').value,
    topicId: document.getElementById('matTopic').value,
    title: document.getElementById('matTitle').value,
    description: document.getElementById('matDesc').value,
    fileBase64: fileBase64, fileName: file ? file.name : ''
  });
  toast('Material uploaded'); document.getElementById('materialForm').reset();
});

// ---- Assignments ------------------------------------------------------------------
guardSubmit(document.getElementById('assignmentForm'), async function () {
  const file = document.getElementById('asgFile').files[0];
  const fileBase64 = file ? await fileToBase64(file) : '';
  await api('createAssignment', {
    subjectId: document.getElementById('asgSubject').value,
    topicId: document.getElementById('asgTopic').value,
    title: document.getElementById('asgTitle').value,
    term: document.getElementById('asgTerm').value,
    description: document.getElementById('asgDesc').value,
    dueDate: document.getElementById('asgDue').value,
    maxScore: document.getElementById('asgMax').value,
    fileBase64: fileBase64, fileName: file ? file.name : ''
  });
  toast('Assignment created'); document.getElementById('assignmentForm').reset();
  await loadAssignmentsForGrading();
});

// ---- Grading ------------------------------------------------------------------------
async function loadAssignmentsForGrading() {
  // Fetch each subject's assignments in parallel rather than one at a time.
  const perSubject = await Promise.all(mySubjects.map(function (s) { return api('listAssignments', { subjectId: s.SubjectID }); }));
  const all = [].concat.apply([], perSubject);
  const sel = document.getElementById('gradeAssignment');
  sel.innerHTML = '<option value="">All</option>' + all.map(function (a) { return '<option value="' + a.AssignmentID + '">' + a.Title + '</option>'; }).join('');
  sel.onchange = loadSubmissions;
  window._assignments = all;
  loadSubmissions();
}
async function loadSubmissions() {
  const assignmentId = document.getElementById('gradeAssignment').value;
  let rowsPromise;
  if (assignmentId) {
    rowsPromise = api('listSubmissions', { assignmentId: assignmentId });
  } else {
    rowsPromise = Promise.all((window._assignments || []).map(function (a) { return api('listSubmissions', { assignmentId: a.AssignmentID }); }))
      .then(function (perAssignment) { return [].concat.apply([], perAssignment); });
  }
  const rows = await rowsPromise;
  const roster = myRoster;
  const body = document.getElementById('submissionsBody');
  body.innerHTML = rows.length ? '' : '<tr><td colspan="7" class="muted">No submissions yet</td></tr>';
  rows.forEach(function (r) {
    const student = roster.find(function (s) { return s.UserID === r.StudentID; });
    const tr = document.createElement('tr');
    tr.innerHTML = '<td>' + (student ? student.FullName : r.StudentID) + '</td><td>' + fmtDate(r.DateSubmitted) + '</td>' +
      '<td><a href="' + r.FileURL + '" target="_blank">View</a></td><td></td><td></td><td></td><td></td>';
    const scoreInput = document.createElement('input'); scoreInput.type = 'number'; scoreInput.value = r.Score || '';
    const gradeInput = document.createElement('input'); gradeInput.type = 'text'; gradeInput.value = r.Grade || '';
    const fbInput = document.createElement('input'); fbInput.type = 'text'; fbInput.value = r.Feedback || '';
    const saveBtn = document.createElement('button'); saveBtn.textContent = 'Save';
    guardClick(saveBtn, async function () {
      await api('gradeSubmission', { submissionId: r.SubmissionID, score: scoreInput.value, grade: gradeInput.value, feedback: fbInput.value });
      toast('Graded');
    });
    tr.children[3].appendChild(scoreInput);
    tr.children[4].appendChild(gradeInput);
    tr.children[5].appendChild(fbInput);
    tr.children[6].appendChild(saveBtn);
    body.appendChild(tr);
  });
}

// ---- Tasks (topic mastery quizzes) --------------------------------------------------
let questionCount = 0;
function addQuestionRow() {
  questionCount++;
  const div = document.createElement('div');
  div.className = 'card';
  div.style.background = '#f7faf8';
  div.innerHTML = '<label>Question ' + questionCount + '</label><input type="text" class="q-text">' +
    '<div class="grid cols-2">' +
    '<div><label>Choice A</label><input type="text" class="q-choice"></div>' +
    '<div><label>Choice B</label><input type="text" class="q-choice"></div>' +
    '<div><label>Choice C</label><input type="text" class="q-choice"></div>' +
    '<div><label>Choice D</label><input type="text" class="q-choice"></div>' +
    '</div><label>Correct choice</label><select class="q-answer"><option value="0">A</option><option value="1">B</option><option value="2">C</option><option value="3">D</option></select>';
  document.getElementById('questionsBuilder').appendChild(div);
}
document.getElementById('addQuestionBtn').addEventListener('click', addQuestionRow);
addQuestionRow();

guardClick(document.getElementById('saveTaskBtn'), async function () {
  const subjectId = document.getElementById('taskSubject').value;
  const topicId = document.getElementById('taskTopic').value;
  const title = document.getElementById('taskTitle').value;
  if (!subjectId || !topicId || !title) { toast('Subject, topic, and title are required', true); return; }
  const blocks = document.querySelectorAll('#questionsBuilder .card');
  const questions = Array.from(blocks).map(function (b) {
    const choices = Array.from(b.querySelectorAll('.q-choice')).map(function (i) { return i.value; });
    return { q: b.querySelector('.q-text').value, choices: choices, answer: Number(b.querySelector('.q-answer').value) };
  }).filter(function (q) { return q.q; });
  if (!questions.length) { toast('Add at least one question', true); return; }
  await api('createTask', {
    subjectId: subjectId, topicId: topicId, title: title,
    passMarkPercent: document.getElementById('taskPass').value,
    questions: JSON.stringify(questions)
  });
  toast('Task created');
  document.getElementById('questionsBuilder').innerHTML = ''; questionCount = 0; addQuestionRow();
  document.getElementById('taskTitle').value = '';
});

async function loadTaskResults() {
  const rows = await api('listTaskResults', {});
  const roster = myRoster;
  const body = document.getElementById('taskResultsBody');
  body.innerHTML = rows.length ? '' : '<tr><td colspan="7" class="muted">No results yet</td></tr>';
  rows.slice().reverse().forEach(function (r) {
    const student = roster.find(function (s) { return s.UserID === r.StudentID; });
    const tr = document.createElement('tr');
    tr.innerHTML = '<td>' + (student ? student.FullName : r.StudentID) + '</td><td>' + r.TaskID + '</td>' +
      '<td>' + r.Score + '/' + r.MaxScore + '</td><td>' + r.Percentage + '%</td>' +
      '<td><span class="badge ' + (r.PassStatus === 'Pass' ? 'pass' : 'fail') + '">' + r.PassStatus + '</span></td>' +
      '<td class="muted" style="max-width:220px;">' + (r.Recommendation || '') + '</td><td>' + fmtDate(r.DateTaken) + '</td>';
    body.appendChild(tr);
  });
}

// ---- Templates (admin-created, per subject) --------------------------------------------
async function loadTemplates() {
  const lpSubjectId = document.getElementById('lpSubject').value;
  const sylSubjectId = document.getElementById('sylSubject').value;
  renderTemplateTable('lpTemplatesBody', 'LessonPlan', lpSubjectId);
  renderTemplateTable('sylTemplatesBody', 'Syllabus', sylSubjectId);
}
async function renderTemplateTable(bodyId, type, subjectId) {
  const body = document.getElementById(bodyId);
  if (!subjectId) {
    body.innerHTML = '<tr><td colspan="3" class="muted">Choose a subject above to see its templates.</td></tr>';
    return;
  }
  const rows = await api('listTemplates', { subjectId: subjectId, type: type }).catch(function () { return []; });
  const subj = mySubjects.find(function (s) { return s.SubjectID === subjectId; });
  body.innerHTML = rows.length ? '' : '<tr><td colspan="3" class="muted">No templates uploaded for this subject yet.</td></tr>';
  rows.forEach(function (t) {
    const tr = document.createElement('tr');
    tr.innerHTML = '<td>' + (subj ? subj.SubjectName : subjectId) + '</td><td>' + t.Title + '</td>' +
      '<td><a href="' + t.FileURL + '" target="_blank">Download</a></td>';
    body.appendChild(tr);
  });
}

// ---- Lesson plans (pre-teaching planning documents) --------------------------------------
guardSubmit(document.getElementById('lpForm'), async function () {
  const subtopicId = document.getElementById('lpSubtopic').value;
  const file = document.getElementById('lpFile').files[0];
  const fileBase64 = file ? await fileToBase64(file) : '';
  await api('uploadLessonPlan', {
    subjectId: document.getElementById('lpSubject').value,
    topicId: document.getElementById('lpTopic').value,
    subtopicId: subtopicId,
    title: document.getElementById('lpTitle').value,
    lessonDate: document.getElementById('lpDate').value,
    objectives: document.getElementById('lpObjectives').value,
    activities: document.getElementById('lpActivities').value,
    resources: document.getElementById('lpResources').value,
    fileBase64: fileBase64
  });
  toast('Lesson plan submitted for review'); document.getElementById('lpForm').reset(); await loadLessonPlans();
});
async function loadLessonPlans() {
  const rows = await api('listLessonPlans', {});
  const body = document.getElementById('lpBody');
  body.innerHTML = rows.length ? '' : '<tr><td colspan="6" class="muted">None yet</td></tr>';
  const allSubtopics = await api('listSubtopics', {}).catch(function () { return []; });
  rows.slice().reverse().forEach(function (r) {
    const subj = mySubjects.find(function (s) { return s.SubjectID === r.SubjectID; });
    const subtopic = allSubtopics.find(function (st) { return st.SubtopicID === r.SubtopicID; });
    const statusCls = r.ReviewStatus === 'Approved' ? 'pass' : (r.ReviewStatus === 'Rejected' ? 'fail' : 'pending');
    const tr = document.createElement('tr');
    tr.innerHTML = '<td>' + r.Title + '</td><td>' + (subj ? subj.SubjectName : r.SubjectID) + '</td>' +
      '<td>' + (subtopic ? subtopic.SubtopicName : (r.SubtopicID || '—')) + '</td>' +
      '<td><span class="badge ' + statusCls + '">' + (r.ReviewStatus || 'Pending') + '</span></td>' +
      '<td>' + fmtDate(r.LessonDate || r.DateUploaded) + '</td>' +
      '<td>' + (r.FileURL ? ('<a href="' + r.FileURL + '" target="_blank">Open</a>') : '—') + '</td>';
    body.appendChild(tr);
  });
}

// ---- Syllabus ------------------------------------------------------------------------------
guardSubmit(document.getElementById('sylForm'), async function () {
  const file = document.getElementById('sylFile').files[0];
  const fileBase64 = file ? await fileToBase64(file) : '';
  await api('uploadSyllabus', {
    subjectId: document.getElementById('sylSubject').value,
    topicId: document.getElementById('sylTopic').value,
    term: document.getElementById('sylTerm').value,
    weekNumber: document.getElementById('sylWeek').value,
    content: document.getElementById('sylContent').value,
    fileBase64: fileBase64
  });
  toast('Syllabus uploaded'); document.getElementById('sylForm').reset();
});

// ---- Curriculum & Quality Assurance ---------------------------------------------
async function renderCurriculum() {
  const subjectId = document.getElementById('curSubject').value;
  const container = document.getElementById('curTopicsContainer');
  if (!subjectId) { container.innerHTML = '<p class="muted">Choose a subject.</p>'; return; }
  container.innerHTML = '<p class="muted">Loading…</p>';

  const topics = await api('listTopics', { subjectId: subjectId });
  if (!topics.length) { container.innerHTML = '<p class="muted">No topics yet for this subject. Add one from the Subjects tab (admin) first.</p>'; return; }

  const subtopicsByTopic = {}, lessonReportsByTopic = {};
  await Promise.all(topics.map(async function (t) {
    const [subs, reports] = await Promise.all([
      api('listSubtopics', { topicId: t.TopicID }),
      api('listLessonReports', { topicId: t.TopicID })
    ]);
    subtopicsByTopic[t.TopicID] = subs;
    lessonReportsByTopic[t.TopicID] = reports;
  }));

  container.innerHTML = '';
  topics.forEach(function (topic) {
    container.appendChild(renderTopicCard(topic, subtopicsByTopic[topic.TopicID] || [], lessonReportsByTopic[topic.TopicID] || []));
  });
}

function progressBadge(status) {
  const map = {
    NotStarted: { label: 'Not Started', cls: 'pending' },
    InProgress: { label: 'In Progress', cls: 'pending' },
    Completed: { label: 'Completed', cls: 'pass' }
  };
  return map[status] || map.NotStarted;
}

function renderTopicCard(topic, subtopics, lessonReports) {
  const status = topic.ProgressStatus || 'NotStarted';
  const badge = progressBadge(status);
  const card = document.createElement('div');
  card.className = 'card';
  card.style.background = '#f7faf8';
  card.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">' +
    '<h3 style="margin:0;">' + topic.TopicName + '</h3>' +
    '<span class="badge ' + badge.cls + '">' + badge.label + '</span></div>';

  if (status === 'NotStarted') {
    const startBtn = document.createElement('button');
    startBtn.textContent = 'Start Topic';
    guardClick(startBtn, async function () {
      await api('startTopic', { topicId: topic.TopicID });
      toast('Topic started'); await renderCurriculum();
    });
    const hint = document.createElement('p');
    hint.className = 'muted';
    hint.style.marginTop = '4px';
    hint.textContent = 'Or just add a sub-topic below — that starts the topic automatically.';
    card.appendChild(startBtn);
    card.appendChild(hint);
  }

  // Build the "Submit lesson report" form first (not yet attached to the
  // card) so the sub-topics table below can jump straight to it with the
  // right sub-topic pre-selected, instead of navigating to a different tab.
  const reportForm = document.createElement('div');
  reportForm.style.marginTop = '14px';
  reportForm.style.borderTop = '1px solid #ddd';
  reportForm.style.paddingTop = '10px';
  reportForm.innerHTML = '<strong>Submit lesson report</strong> <span class="muted">— after teaching, log what happened and submit for review. Required for every sub-topic before it can be marked Complete.</span>';
  const reportGrid = document.createElement('div');
  reportGrid.className = 'grid cols-2';
  const reportSubtopicSelect = document.createElement('select');
  reportSubtopicSelect.innerHTML = '<option value="">Whole topic</option>' +
    subtopics.map(function (st) { return '<option value="' + st.SubtopicID + '">' + st.SubtopicName + '</option>'; }).join('');
  const reportTitleInput = document.createElement('input'); reportTitleInput.type = 'text'; reportTitleInput.placeholder = 'Report title';
  const reportDateInput = document.createElement('input'); reportDateInput.type = 'date';
  const reportFeedbackInput = document.createElement('textarea'); reportFeedbackInput.placeholder = 'Feedback / notes on how the lesson went';
  const reportWentWellInput = document.createElement('textarea'); reportWentWellInput.placeholder = 'What went well';
  const reportChallengesInput = document.createElement('textarea'); reportChallengesInput.placeholder = 'Challenges faced';
  const reportFileInput = document.createElement('input'); reportFileInput.type = 'file';
  const reportBtn = document.createElement('button'); reportBtn.textContent = 'Submit lesson report';
  guardClick(reportBtn, async function () {
    if (!reportTitleInput.value.trim()) { toast('Enter a report title', true); return; }
    const file = reportFileInput.files[0];
    const fileBase64 = file ? await fileToBase64(file) : '';
    await api('uploadLessonReport', {
      topicId: topic.TopicID, subtopicId: reportSubtopicSelect.value,
      title: reportTitleInput.value.trim(), lessonDate: reportDateInput.value,
      feedbackNotes: reportFeedbackInput.value, whatWentWell: reportWentWellInput.value,
      challenges: reportChallengesInput.value, fileBase64: fileBase64, fileName: file ? file.name : ''
    });
    toast('Lesson report submitted for review');
    reportTitleInput.value = ''; reportFeedbackInput.value = ''; reportWentWellInput.value = ''; reportChallengesInput.value = ''; reportFileInput.value = '';
    await renderCurriculum();
    await loadLessonReportReviewStatus();
  });
  reportGrid.appendChild(reportSubtopicSelect);
  reportGrid.appendChild(reportTitleInput);
  reportGrid.appendChild(reportDateInput);
  reportGrid.appendChild(reportFileInput);
  reportGrid.appendChild(reportFeedbackInput);
  reportGrid.appendChild(reportWentWellInput);
  reportGrid.appendChild(reportChallengesInput);
  reportGrid.appendChild(reportBtn);
  reportForm.appendChild(reportGrid);

  // Sub-topics list
  const list = document.createElement('table');
  list.innerHTML = '<thead><tr><th>Sub-topic</th><th>Status</th><th>Lesson report</th><th></th></tr></thead>';
  const tbody = document.createElement('tbody');
  subtopics.forEach(function (st) {
    const hasApprovedReport = lessonReports.some(function (lr) { return lr.SubtopicID === st.SubtopicID && lr.ReviewStatus === 'Approved'; });
    const hasAnyReport = lessonReports.some(function (lr) { return lr.SubtopicID === st.SubtopicID; });
    const tr = document.createElement('tr');
    tr.innerHTML = '<td>' + st.SubtopicName + '</td>' +
      '<td><span class="badge ' + (st.Status === 'Completed' ? 'pass' : 'pending') + '">' + (st.Status === 'Completed' ? 'Completed' : 'Not complete') + '</span></td>' +
      '<td></td><td></td>';
    const reportTd = tr.children[2], actionTd = tr.children[3];

    if (hasApprovedReport) reportTd.innerHTML = '<span class="badge pass">Approved</span>';
    else if (hasAnyReport) reportTd.innerHTML = '<span class="badge pending">Pending review</span>';
    else reportTd.innerHTML = '<span class="badge fail">Required</span>';

    if (st.Status !== 'Completed') {
      if (!hasAnyReport) {
        const uploadLink = document.createElement('button');
        uploadLink.className = 'secondary';
        uploadLink.textContent = 'Submit lesson report';
        uploadLink.type = 'button';
        uploadLink.onclick = function () {
          reportSubtopicSelect.value = st.SubtopicID;
          reportForm.scrollIntoView({ behavior: 'smooth', block: 'center' });
          reportTitleInput.focus();
        };
        actionTd.appendChild(uploadLink);
      } else {
        const completeBtn = document.createElement('button');
        completeBtn.textContent = 'Mark Complete';
        guardClick(completeBtn, async function () {
          try {
            await api('setSubtopicStatus', { subtopicId: st.SubtopicID, status: 'Completed' });
            toast('Sub-topic completed'); await renderCurriculum();
          } catch (err) { toast(err.message, true); }
        });
        actionTd.appendChild(completeBtn);
      }
    }
    tbody.appendChild(tr);
  });
  list.appendChild(tbody);
  card.appendChild(list);
  if (!subtopics.length) {
    const p = document.createElement('p');
    p.className = 'muted';
    p.textContent = 'No sub-topics added yet.';
    card.appendChild(p);
  }

  // Add sub-topic form
  const addForm = document.createElement('div');
  addForm.className = 'grid cols-2';
  addForm.style.marginTop = '10px';
  const nameInput = document.createElement('input'); nameInput.type = 'text'; nameInput.placeholder = 'Sub-topic name';
  const addBtn = document.createElement('button'); addBtn.textContent = 'Add sub-topic';
  guardClick(addBtn, async function () {
    if (!nameInput.value.trim()) { toast('Enter a sub-topic name', true); return; }
    await api('addSubtopic', { topicId: topic.TopicID, subtopicName: nameInput.value.trim() });
    nameInput.value = ''; toast('Sub-topic added'); await renderCurriculum();
  });
  addForm.appendChild(nameInput); addForm.appendChild(addBtn);
  card.appendChild(addForm);

  card.appendChild(reportForm);

  // Manual complete fallback for topics with no sub-topics
  if (!subtopics.length && status !== 'Completed') {
    const completeTopicBtn = document.createElement('button');
    completeTopicBtn.className = 'secondary'; completeTopicBtn.style.marginTop = '10px';
    completeTopicBtn.textContent = 'Mark Topic Complete (no sub-topics needed)';
    guardClick(completeTopicBtn, async function () {
      await api('completeTopic', { topicId: topic.TopicID });
      toast('Topic marked complete'); await renderCurriculum();
    });
    card.appendChild(completeTopicBtn);
  }

  return card;
}

async function loadLessonReportReviewStatus() {
  const rows = await api('listLessonReports', {});
  const body = document.getElementById('curLrReviewBody');
  body.innerHTML = rows.length ? '' : '<tr><td colspan="4" class="muted">No lesson reports submitted yet</td></tr>';
  rows.slice().reverse().forEach(function (r) {
    const topic = allTopics.find(function (t) { return t.TopicID === r.TopicID; });
    const statusCls = r.ReviewStatus === 'Approved' ? 'pass' : (r.ReviewStatus === 'Rejected' ? 'fail' : 'pending');
    const tr = document.createElement('tr');
    tr.innerHTML = '<td>' + r.Title + '</td><td>' + (topic ? topic.TopicName : r.TopicID) + '</td>' +
      '<td><span class="badge ' + statusCls + '">' + (r.ReviewStatus || 'Pending') + '</span></td>' +
      '<td class="muted">' + (r.ReviewNotes || '—') + '</td>';
    body.appendChild(tr);
  });
}

// ---- Past Questions: teacher assigns papers to students -------------------------
let ppPapers = [], ppRosterStudents = [];

async function initPastQuestionsAssign() {
  const subjOpts = mySubjects.map(function (s) { return '<option value="' + s.SubjectID + '">' + s.SubjectName + '</option>'; }).join('');
  document.getElementById('ppSubject').innerHTML = subjOpts;
  document.getElementById('ppSubject').addEventListener('change', loadPastQuestionsForSubject);
  document.getElementById('ppPaper').addEventListener('change', renderStudentPicker);
  guardClick(document.getElementById('ppAssignBtn'), submitAssignment_);
  await loadPastQuestionsForSubject();
  await loadMyAssignments();
}

async function loadPastQuestionsForSubject() {
  const subjectId = document.getElementById('ppSubject').value;
  if (!subjectId) return;
  ppPapers = await api('listPastPapers', { subjectId: subjectId });
  const paperSel = document.getElementById('ppPaper');
  paperSel.innerHTML = ppPapers.length
    ? ppPapers.map(function (pp) { return '<option value="' + pp.PaperID + '">' + pp.Title + ' (' + pp.PaperType + ', ' + pp.Year + ')</option>'; }).join('')
    : '<option value="">No papers uploaded for this subject yet</option>';
  ppRosterStudents = await api('listRegisteredStudents', { subjectId: subjectId }).catch(function () { return []; });
  renderStudentPicker();
}

function renderStudentPicker() {
  const container = document.getElementById('ppStudentPicker');
  if (!ppRosterStudents.length) {
    container.innerHTML = '<p class="muted">No students registered to this subject yet.</p>';
    return;
  }
  const selectAllId = 'ppSelectAll';
  let html = '<label><input type="checkbox" id="' + selectAllId + '"> Select all registered students</label><br>';
  html += ppRosterStudents.map(function (s) {
    return '<label style="display:inline-block;margin:4px 10px 4px 0;font-weight:normal;">' +
      '<input type="checkbox" class="pp-student-cb" value="' + s.UserID + '"> ' + s.FullName + '</label>';
  }).join('');
  container.innerHTML = html;
  document.getElementById(selectAllId).addEventListener('change', function () {
    document.querySelectorAll('.pp-student-cb').forEach(function (cb) { cb.checked = document.getElementById(selectAllId).checked; });
  });
}

async function submitAssignment_() {
  const paperId = document.getElementById('ppPaper').value;
  if (!paperId) { toast('Choose a paper', true); return; }
  const studentIds = Array.from(document.querySelectorAll('.pp-student-cb:checked')).map(function (cb) { return cb.value; });
  if (!studentIds.length) { toast('Select at least one student', true); return; }
  const result = await api('assignPastPaper', { paperId: paperId, studentIds: JSON.stringify(studentIds) });
  toast(result.message);
  await loadMyAssignments();
}

async function loadMyAssignments() {
  const rows = await api('listPastPaperAssignments', {});
  const body = document.getElementById('ppAssignmentsBody');
  body.innerHTML = rows.length ? '' : '<tr><td colspan="5" class="muted">No assignments yet</td></tr>';
  const roster = myRoster;
  const scores = await Promise.all(rows.map(function (r) {
    if (!r.TaskID) return Promise.resolve(null);
    return api('getPastPaperAttempts', { paperId: r.PaperID, studentId: r.StudentID }).catch(function () { return null; });
  }));
  rows.slice().reverse().forEach(function (r, revIdx) {
    const idx = rows.length - 1 - revIdx;
    const attempt = scores[idx];
    const paper = ppPapers.find(function (pp) { return pp.PaperID === r.PaperID; }) || { Title: r.PaperID };
    const subj = mySubjects.find(function (s) { return s.SubjectID === r.SubjectID; });
    const student = roster.find(function (u) { return u.UserID === r.StudentID; });
    const scoreText = !r.TaskID ? 'N/A (Theory)' : (attempt && attempt.latest ? attempt.latest.Percentage + '%' : 'Not attempted');
    const tr = document.createElement('tr');
    tr.innerHTML = '<td>' + paper.Title + '</td><td>' + (subj ? subj.SubjectName : r.SubjectID) + '</td>' +
      '<td>' + (student ? student.FullName : r.StudentID) + '</td><td>' + fmtDate(r.DateAssigned) + '</td><td>' + scoreText + '</td>';
    body.appendChild(tr);
  });
}

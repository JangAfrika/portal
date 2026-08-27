const me = requirePage(['Admin']);

document.querySelectorAll('.tabs button').forEach(function (btn) {
  btn.addEventListener('click', function () {
    document.querySelectorAll('.tabs button').forEach(function (b) { b.classList.remove('active'); });
    document.querySelectorAll('.tabpane').forEach(function (p) { p.classList.add('hidden'); });
    btn.classList.add('active');
    document.getElementById('tab-' + btn.dataset.tab).classList.remove('hidden');
  });
});

let allUsers = [], allSubjects = [], allTopics = [], allSubtopics = [];

async function loadAll() {
  // Phase 0: loadUsers MUST finish before anything else, since almost every
  // other table looks up names from allUsers (teachers on subjects, students
  // on payments/marks/attendance, reviewers on lesson plans/reports, etc.).
  // Running it in the same batch as those was a race condition — whichever
  // finished first "won", so teacher/student names would randomly fall back
  // to raw IDs. Phase 1 covers everything else with no such dependency.
  await safeLoad('usersBody', 6, loadUsers);
  await Promise.all([
    safeLoad('subjectsBody', 4, loadSubjects),
    safeLoad('pendingBody', 5, loadPending),
    safeCall(function () { return api('listTopics', {}).then(function (rows) { allTopics = rows; }); }, 'topics'),
    safeCall(function () { return api('listSubtopics', {}).then(function (rows) { allSubtopics = rows; }); }, 'sub-topics'),
    loadSettings().catch(function (err) { toast('Could not load settings: ' + err.message, true); })
  ]);
  // Phase 2 depends on both allUsers (phase 0) and allSubjects (phase 1).
  await Promise.all([
    safeLoad('paymentsBody', 7, loadPayments),
    safeLoad('marksBody', 8, loadMarks),
    safeLoad('templatesBody', 6, loadTemplates),
    safeLoad('pastPapersBody', 7, loadPastPapers),
    safeLoad('ppOverviewBody', 7, loadPastPaperPerformanceOverview),
    safeLoad('attendanceBody', 6, loadAttendance),
    safeLoad('curOverviewBody', 7, loadCurriculumOverview),
    safeLoad('lpReviewBody', 8, loadLessonPlanReviewQueue),
    safeLoad('lrReviewBody', 8, loadLessonReportReviewQueue)
  ]);
  fillStudentSelects();
  fillSubjectSelects();
}
loadAll();

// ---- Approvals --------------------------------------------------------------
async function loadPending() {
  const rows = await api('listPendingRegistrations', {});
  const body = document.getElementById('pendingBody');
  body.innerHTML = rows.length ? '' : '<tr><td colspan="5" class="muted">No pending registrations 🎉</td></tr>';
  rows.forEach(function (r) {
    const tr = document.createElement('tr');
    tr.innerHTML = '<td>' + r.FullName + '</td><td>' + r.RequestedRole + '</td><td>' + r.Email + '</td>' +
      '<td>' + fmtDate(r.DateSubmitted) + '</td><td></td>';
    const td = tr.lastElementChild;
    const approveBtn = document.createElement('button');
    approveBtn.textContent = 'Approve';
    guardClick(approveBtn, async function () {
      await api('approveRegistration', { regId: r.RegID }); toast('Approved'); await loadAll();
    });
    const rejectBtn = document.createElement('button');
    rejectBtn.textContent = 'Reject'; rejectBtn.className = 'danger'; rejectBtn.style.marginLeft = '6px';
    guardClick(rejectBtn, async function () {
      await api('rejectRegistration', { regId: r.RegID }); toast('Rejected'); await loadAll();
    });
    td.appendChild(approveBtn); td.appendChild(rejectBtn);
    body.appendChild(tr);
  });
}

// ---- Users --------------------------------------------------------------------
async function loadUsers() {
  allUsers = await api('listUsers', {});
  const body = document.getElementById('usersBody');
  body.innerHTML = '';
  allUsers.forEach(function (u) {
    const payBadge = u.Role === 'Student' ? paymentTierBadge(u.PaymentStatus) : null;
    const tr = document.createElement('tr');
    tr.innerHTML = '<td>' + u.FullName + '</td><td>' + u.Role + '</td><td>' + u.Email + '</td>' +
      '<td><span class="badge ' + (u.Status === 'Active' ? 'active' : 'suspended') + '">' + u.Status + '</span></td>' +
      '<td>' + (payBadge ? ('<span class="badge ' + payBadge.className + '">' + payBadge.label + '</span>') : '—') + '</td><td></td>';
    const td = tr.lastElementChild;
    const toggleBtn = document.createElement('button');
    toggleBtn.textContent = (u.Status === 'Active') ? 'Suspend' : 'Reactivate';
    toggleBtn.className = (u.Status === 'Active') ? 'danger' : 'secondary';
    guardClick(toggleBtn, async function () {
      await api('suspendUser', { userId: u.UserID, status: (u.Status === 'Active') ? 'Suspended' : 'Active' });
      toast('Updated'); await loadUsers();
    });
    td.appendChild(toggleBtn);
    body.appendChild(tr);
  });
}

// ---- Subjects & topics ----------------------------------------------------------
async function loadSubjects() {
  allSubjects = await api('listSubjects', {});
  const body = document.getElementById('subjectsBody');
  body.innerHTML = '';
  allSubjects.forEach(function (s) {
    const teacherNames = String(s.TeacherIDs || '').split(',').filter(Boolean)
      .map(function (id) { const t = allUsers.find(function (u) { return u.UserID === id; }); return t ? t.FullName : id; }).join(', ') || '—';
    const tr = document.createElement('tr');
    tr.innerHTML = '<td>' + s.SubjectName + '</td><td>' + teacherNames + '</td><td>' + s.Status + '</td><td></td>';
    const td = tr.lastElementChild;

    const teacherSelect = document.createElement('select');
    teacherSelect.innerHTML = '<option value="">Assign teacher…</option>' +
      allUsers.filter(function (u) { return u.Role === 'Staff'; })
        .map(function (t) { return '<option value="' + t.UserID + '">' + t.FullName + '</option>'; }).join('');
    teacherSelect.onchange = async function () {
      if (!this.value) return;
      try { await api('assignTeacher', { subjectId: s.SubjectID, teacherId: this.value }); toast('Teacher assigned'); loadAll(); }
      catch (err) { toast(err.message, true); }
    };
    const removeBtn = document.createElement('button');
    removeBtn.textContent = 'Remove'; removeBtn.className = 'danger'; removeBtn.style.marginLeft = '6px';
    guardClick(removeBtn, async function () {
      if (!confirm('Remove subject "' + s.SubjectName + '"?')) return;
      await api('removeSubject', { subjectId: s.SubjectID }); toast('Removed'); await loadAll();
    });
    td.appendChild(teacherSelect); td.appendChild(removeBtn);
    body.appendChild(tr);
  });
}

guardSubmit(document.getElementById('subjectForm'), async function () {
  await api('addSubject', { subjectName: document.getElementById('subjName').value });
  document.getElementById('subjName').value = '';
  toast('Subject added'); await loadAll();
});

guardSubmit(document.getElementById('topicForm'), async function () {
  await api('addTopic', { subjectId: document.getElementById('topicSubject').value, topicName: document.getElementById('topicName').value });
  document.getElementById('topicName').value = '';
  toast('Topic added');
});

function fillSubjectSelects() {
  const opts = allSubjects.map(function (s) { return '<option value="' + s.SubjectID + '">' + s.SubjectName + '</option>'; }).join('');
  ['topicSubject', 'markSubject', 'tplSubject'].forEach(function (id) { document.getElementById(id).innerHTML = opts; });
}

function fillStudentSelects() {
  const opts = allUsers.filter(function (u) { return u.Role === 'Student'; })
    .map(function (u) { return '<option value="' + u.UserID + '">' + u.FullName + ' (' + paymentTierBadge(u.PaymentStatus).label + ')</option>'; }).join('');
  ['markStudent', 'paySt'].forEach(function (id) { document.getElementById(id).innerHTML = opts; });
}

// ---- Marks -----------------------------------------------------------------
guardSubmit(document.getElementById('marksForm'), async function () {
  await api('uploadMarks', {
    studentId: document.getElementById('markStudent').value,
    subjectId: document.getElementById('markSubject').value,
    term: document.getElementById('markTerm').value,
    test: document.getElementById('markTest').value,
    exam: document.getElementById('markExam').value
  });
  toast('Marks uploaded'); document.getElementById('marksForm').reset(); await loadMarks();
});

async function loadMarks() {
  const rows = await api('listMarks', {});
  const body = document.getElementById('marksBody');
  body.innerHTML = rows.length ? '' : '<tr><td colspan="8" class="muted">No marks uploaded yet</td></tr>';
  rows.slice().reverse().forEach(function (m) {
    const student = allUsers.find(function (u) { return u.UserID === m.StudentID; });
    const subj = allSubjects.find(function (s) { return s.SubjectID === m.SubjectID; });
    const tr = document.createElement('tr');
    tr.innerHTML = '<td>' + (student ? student.FullName : m.StudentID) + '</td>' +
      '<td>' + (subj ? subj.SubjectName : m.SubjectID) + '</td><td>' + m.Term + '</td>' +
      '<td>' + (m.AssignmentsAvg === '' ? '—' : m.AssignmentsAvg + '%') + '</td>' +
      '<td>' + (m.Test === '' ? '—' : m.Test + '%') + '</td><td>' + (m.Exam === '' ? '—' : m.Exam + '%') + '</td>' +
      '<td>' + (m.Score === '' ? '—' : m.Score + '%') + '</td><td>' + (m.Grade || '—') + '</td>';
    body.appendChild(tr);
  });
}

// ---- Payments -----------------------------------------------------------------------
guardSubmit(document.getElementById('paymentForm'), async function () {
  await api('recordPayment', {
    studentId: document.getElementById('paySt').value,
    amount: document.getElementById('payAmount').value,
    term: document.getElementById('payTerm').value,
    method: document.getElementById('payMethod').value,
    reference: document.getElementById('payRef').value,
    status: 'Paid'
  });
  toast('Payment recorded'); document.getElementById('paymentForm').reset(); await loadAll();
});

async function loadPayments() {
  const rows = await api('listPayments', {});
  const body = document.getElementById('paymentsBody');
  body.innerHTML = rows.length ? '' : '<tr><td colspan="7" class="muted">No payments yet</td></tr>';
  rows.slice().reverse().forEach(function (r) {
    const student = allUsers.find(function (u) { return u.UserID === r.StudentID; });
    const tierBadge = student ? paymentTierBadge(student.PaymentStatus) : null;
    const tr = document.createElement('tr');
    tr.innerHTML = '<td>' + (student ? student.FullName : r.StudentID) + '</td><td></td><td></td>' +
      '<td>' + fmtDate(r.DatePaid) + '</td><td></td>' +
      '<td>' + (tierBadge ? ('<span class="badge ' + tierBadge.className + '">' + tierBadge.label + '</span>') : '—') + '</td><td></td>';

    const amountTd = tr.children[1], termTd = tr.children[2], statusTd = tr.children[4], actionsTd = tr.children[6];
    const amountInput = document.createElement('input'); amountInput.type = 'number'; amountInput.value = r.Amount; amountInput.style.width = '90px'; amountInput.disabled = true;
    const termInput = document.createElement('input'); termInput.type = 'text'; termInput.value = r.Term || ''; termInput.style.width = '90px'; termInput.disabled = true;
    const statusSelect = document.createElement('select'); statusSelect.disabled = true;
    statusSelect.innerHTML = ['Paid', 'Pending', 'Refunded'].map(function (s) { return '<option' + (s === r.Status ? ' selected' : '') + '>' + s + '</option>'; }).join('');
    amountTd.appendChild(amountInput); termTd.appendChild(termInput); statusTd.appendChild(statusSelect);

    const editBtn = document.createElement('button');
    editBtn.textContent = 'Edit'; editBtn.className = 'secondary';
    const saveBtn = document.createElement('button');
    saveBtn.textContent = 'Save'; saveBtn.className = 'hidden';
    editBtn.onclick = function () {
      [amountInput, termInput, statusSelect].forEach(function (el) { el.disabled = false; });
      editBtn.classList.add('hidden'); saveBtn.classList.remove('hidden');
    };
    guardClick(saveBtn, async function () {
      await api('updatePayment', {
        paymentId: r.PaymentID, amount: amountInput.value, term: termInput.value, status: statusSelect.value
      });
      toast('Payment updated'); await loadAll();
    });
    actionsTd.appendChild(editBtn); actionsTd.appendChild(saveBtn);
    body.appendChild(tr);
  });
}

// ---- Attendance ------------------------------------------------------------------
async function loadAttendance() {
  const subjOpts = allSubjects.map(function (s) { return '<option value="' + s.SubjectID + '">' + s.SubjectName + '</option>'; }).join('');
  const stOpts = allUsers.filter(function (u) { return u.Role === 'Student'; })
    .map(function (u) { return '<option value="' + u.UserID + '">' + u.FullName + '</option>'; }).join('');
  const subjSel = document.getElementById('attFilterSubject');
  const stSel = document.getElementById('attFilterStudent');
  if (subjSel.options.length <= 1) subjSel.insertAdjacentHTML('beforeend', subjOpts);
  if (stSel.options.length <= 1) stSel.insertAdjacentHTML('beforeend', stOpts);
  subjSel.onchange = renderAttendance;
  stSel.onchange = renderAttendance;
  await renderAttendance();
}
async function renderAttendance() {
  const subjectId = document.getElementById('attFilterSubject').value;
  const studentId = document.getElementById('attFilterStudent').value;
  const rows = await api('listAttendance', { subjectId: subjectId, studentId: studentId });
  const body = document.getElementById('attendanceBody');
  body.innerHTML = rows.length ? '' : '<tr><td colspan="6" class="muted">No attendance recorded yet</td></tr>';
  rows.slice().reverse().forEach(function (r) {
    const student = allUsers.find(function (u) { return u.UserID === r.StudentID; });
    const subj = allSubjects.find(function (s) { return s.SubjectID === r.SubjectID; });
    const marker = allUsers.find(function (u) { return u.UserID === r.MarkedBy; });
    const tr = document.createElement('tr');
    tr.innerHTML = '<td>' + fmtDate(r.AttendanceDate) + '</td><td>' + (student ? student.FullName : r.StudentID) + '</td>' +
      '<td>' + (subj ? subj.SubjectName : r.SubjectID) + '</td><td>' + r.Status + '</td>' +
      '<td class="muted">' + (r.Comment || '—') + '</td>' +
      '<td>' + (marker ? marker.FullName : r.MarkedBy) + '</td>';
    body.appendChild(tr);
  });
}

// ---- Templates ------------------------------------------------------------------------
guardSubmit(document.getElementById('templateForm'), async function () {
  const file = document.getElementById('tplFile').files[0];
  if (!file) { toast('Choose a file', true); return; }
  const fileBase64 = await fileToBase64(file);
  await api('createTemplate', {
    type: document.getElementById('tplType').value,
    subjectId: document.getElementById('tplSubject').value,
    title: document.getElementById('tplTitle').value,
    fileBase64: fileBase64, fileName: file.name
  });
  toast('Template created'); document.getElementById('templateForm').reset(); await loadTemplates();
});

async function loadTemplates() {
  const rows = await api('listTemplates', {});
  const body = document.getElementById('templatesBody');
  body.innerHTML = rows.length ? '' : '<tr><td colspan="6" class="muted">No templates yet</td></tr>';
  rows.slice().reverse().forEach(function (t) {
    const subj = allSubjects.find(function (s) { return s.SubjectID === t.SubjectID; });
    const tr = document.createElement('tr');
    tr.innerHTML = '<td>' + (t.Type === 'Syllabus' ? 'Syllabus' : 'Lesson Report') + '</td>' +
      '<td>' + (subj ? subj.SubjectName : t.SubjectID) + '</td><td>' + t.Title + '</td>' +
      '<td><a href="' + t.FileURL + '" target="_blank">Download</a></td><td>' + fmtDate(t.DateUploaded) + '</td><td></td>';
    const delBtn = document.createElement('button');
    delBtn.textContent = 'Delete'; delBtn.className = 'danger';
    guardClick(delBtn, async function () {
      if (!confirm('Delete this template?')) return;
      await api('deleteTemplate', { templateId: t.TemplateID }); toast('Deleted'); await loadTemplates();
    });
    tr.lastElementChild.appendChild(delBtn);
    body.appendChild(tr);
  });
}

// ---- Settings -----------------------------------------------------------------------
async function loadSettings() {
  const rows = await api('getSettings', {});
  const fee = rows.find(function (r) { return r.Key === 'TuitionFeeAmount'; });
  const geminiKey = rows.find(function (r) { return r.Key === 'GeminiApiKey'; });
  document.getElementById('feeAmount').value = fee ? fee.Value : '';
  document.getElementById('geminiKey').value = geminiKey ? geminiKey.Value : '';
}

guardSubmit(document.getElementById('feeForm'), async function () {
  await api('updateSetting', { key: 'TuitionFeeAmount', value: document.getElementById('feeAmount').value });
  toast('Tuition fee saved — student payment tiers recalculated'); await loadAll();
});

guardSubmit(document.getElementById('geminiForm'), async function () {
  await api('updateSetting', { key: 'GeminiApiKey', value: document.getElementById('geminiKey').value });
  toast('Gemini API key saved');
});

// ---- Topic Tests (view-only for admin — teachers submit these from their own dashboard) --
async function loadPastPapers() {
  const [rows, allTopics] = await Promise.all([api('listPastPapers', {}), api('listTopics', {})]);
  const body = document.getElementById('pastPapersBody');
  body.innerHTML = rows.length ? '' : '<tr><td colspan="6" class="muted">No topic tests submitted yet</td></tr>';
  rows.slice().reverse().forEach(function (pp) {
    const subj = allSubjects.find(function (s) { return s.SubjectID === pp.SubjectID; });
    const topic = allTopics.find(function (t) { return t.TopicID === pp.TopicID; });
    const tr = document.createElement('tr');
    tr.innerHTML = '<td>' + (subj ? subj.SubjectName : pp.SubjectID) + '</td>' +
      '<td>' + (topic ? topic.TopicName : '—') + '</td><td>' + pp.PaperType + '</td><td>' + pp.Title + '</td>' +
      '<td class="muted" style="max-width:220px;">' + (pp.ParseWarnings || '—') + '</td><td></td>';
    const delBtn = document.createElement('button');
    delBtn.textContent = 'Delete'; delBtn.className = 'danger';
    guardClick(delBtn, async function () {
      if (!confirm('Delete this topic test?')) return;
      await api('deletePastPaper', { paperId: pp.PaperID }); toast('Deleted'); await loadPastPapers();
    });
    tr.lastElementChild.appendChild(delBtn);
    body.appendChild(tr);
  });
}

// ---- Curriculum & Quality Assurance ---------------------------------------------
function progressBadgeAdmin(status) {
  const map = {
    NotStarted: { label: 'Not Started', cls: 'pending' },
    InProgress: { label: 'In Progress', cls: 'pending' },
    Completed: { label: 'Completed', cls: 'pass' }
  };
  return map[status] || map.NotStarted;
}

async function loadCurriculumOverview() {
  const subjOpts = allSubjects.map(function (s) { return '<option value="' + s.SubjectID + '">' + s.SubjectName + '</option>'; }).join('');
  const filterSel = document.getElementById('curFilterSubject');
  if (filterSel.options.length <= 1) filterSel.insertAdjacentHTML('beforeend', subjOpts);
  filterSel.onchange = renderCurriculumOverview;
  await renderCurriculumOverview();
}

async function renderCurriculumOverview() {
  const subjectId = document.getElementById('curFilterSubject').value;
  const rows = await api('getCurriculumOverview', { subjectId: subjectId });
  const body = document.getElementById('curOverviewBody');
  body.innerHTML = rows.length ? '' : '<tr><td colspan="7" class="muted">No topics yet</td></tr>';
  rows.forEach(function (r) {
    const subj = allSubjects.find(function (s) { return s.SubjectID === r.subjectId; });
    const starter = allUsers.find(function (u) { return u.UserID === r.startedBy; });
    const badge = progressBadgeAdmin(r.progressStatus);
    const tr = document.createElement('tr');
    tr.innerHTML = '<td>' + (subj ? subj.SubjectName : r.subjectId) + '</td><td>' + r.topicName + '</td>' +
      '<td><span class="badge ' + badge.cls + '">' + badge.label + '</span></td>' +
      '<td>' + (starter ? starter.FullName : (r.startedBy || '—')) + '</td>' +
      '<td>' + (r.dateStarted ? fmtDate(r.dateStarted) : '—') + '</td>' +
      '<td>' + r.subtopicCompletedCount + ' / ' + r.subtopicCount + '</td>' +
      '<td>' + (r.dateCompleted ? fmtDate(r.dateCompleted) : '—') + '</td>';
    body.appendChild(tr);
  });
}

function subtopicName(id) {
  const st = allSubtopics.find(function (s) { return s.SubtopicID === id; });
  return st ? st.SubtopicName : (id || '—');
}

async function loadLessonPlanReviewQueue() {
  document.getElementById('lpReviewFilter').addEventListener('change', renderLessonPlanReviewQueue);
  await renderLessonPlanReviewQueue();
}

async function renderLessonPlanReviewQueue() {
  const status = document.getElementById('lpReviewFilter').value;
  const rows = await api('listLessonPlansForReview', { status: status });
  const body = document.getElementById('lpReviewBody');
  body.innerHTML = rows.length ? '' : '<tr><td colspan="8" class="muted">Nothing here</td></tr>';
  rows.slice().reverse().forEach(function (r) {
    const subj = allSubjects.find(function (s) { return s.SubjectID === r.SubjectID; });
    const teacher = allUsers.find(function (u) { return u.UserID === r.TeacherID; });
    const statusCls = r.ReviewStatus === 'Approved' ? 'pass' : (r.ReviewStatus === 'Rejected' ? 'fail' : 'pending');
    const tr = document.createElement('tr');
    tr.innerHTML = '<td>' + r.Title + '</td><td>' + (subj ? subj.SubjectName : r.SubjectID) + '</td>' +
      '<td>' + subtopicName(r.SubtopicID) + '</td>' +
      '<td>' + (teacher ? teacher.FullName : r.TeacherID) + '</td><td>' + fmtDate(r.DateUploaded) + '</td>' +
      '<td>' + (r.FileURL ? ('<a href="' + r.FileURL + '" target="_blank">Open</a>') : '—') + '</td>' +
      '<td><span class="badge ' + statusCls + '">' + (r.ReviewStatus || 'Pending') + '</span></td><td></td>';
    const actionsTd = tr.lastElementChild;
    if (!r.ReviewStatus || r.ReviewStatus === 'Pending') {
      const notesInput = document.createElement('input'); notesInput.type = 'text'; notesInput.placeholder = 'Notes (optional)'; notesInput.style.width = '140px';
      const approveBtn = document.createElement('button'); approveBtn.textContent = 'Approve';
      const rejectBtn = document.createElement('button'); rejectBtn.textContent = 'Reject'; rejectBtn.className = 'danger'; rejectBtn.style.marginLeft = '4px';
      guardClick(approveBtn, async function () {
        await api('reviewLessonPlan', { lessonPlanId: r.LessonPlanID, decision: 'Approved', notes: notesInput.value });
        toast('Approved'); await renderLessonPlanReviewQueue();
      });
      guardClick(rejectBtn, async function () {
        await api('reviewLessonPlan', { lessonPlanId: r.LessonPlanID, decision: 'Rejected', notes: notesInput.value });
        toast('Rejected'); await renderLessonPlanReviewQueue();
      });
      actionsTd.appendChild(notesInput); actionsTd.appendChild(approveBtn); actionsTd.appendChild(rejectBtn);
    } else {
      actionsTd.textContent = r.ReviewNotes || '—';
    }
    body.appendChild(tr);
  });
}

async function loadLessonReportReviewQueue() {
  document.getElementById('lrReviewFilter').addEventListener('change', renderLessonReportReviewQueue);
  await renderLessonReportReviewQueue();
}

async function renderLessonReportReviewQueue() {
  const status = document.getElementById('lrReviewFilter').value;
  const rows = await api('listLessonReportsForReview', { status: status });
  const body = document.getElementById('lrReviewBody');
  body.innerHTML = rows.length ? '' : '<tr><td colspan="8" class="muted">Nothing here</td></tr>';
  rows.slice().reverse().forEach(function (r) {
    const topic = allTopics.find(function (t) { return t.TopicID === r.TopicID; });
    const teacher = allUsers.find(function (u) { return u.UserID === r.TeacherID; });
    const statusCls = r.ReviewStatus === 'Approved' ? 'pass' : (r.ReviewStatus === 'Rejected' ? 'fail' : 'pending');
    const tr = document.createElement('tr');
    tr.innerHTML = '<td>' + r.Title + '</td><td>' + (topic ? topic.TopicName : r.TopicID) + '</td>' +
      '<td>' + subtopicName(r.SubtopicID) + '</td>' +
      '<td>' + (teacher ? teacher.FullName : r.TeacherID) + '</td><td>' + fmtDate(r.DateSubmitted || r.DateUploaded) + '</td>' +
      '<td>' + (r.FileURL ? ('<a href="' + r.FileURL + '" target="_blank">Open</a>') : '—') + '</td>' +
      '<td><span class="badge ' + statusCls + '">' + (r.ReviewStatus || 'Pending') + '</span></td><td></td>';
    const actionsTd = tr.lastElementChild;
    if (!r.ReviewStatus || r.ReviewStatus === 'Pending') {
      const notesInput = document.createElement('input'); notesInput.type = 'text'; notesInput.placeholder = 'Notes (optional)'; notesInput.style.width = '140px';
      const approveBtn = document.createElement('button'); approveBtn.textContent = 'Approve';
      const rejectBtn = document.createElement('button'); rejectBtn.textContent = 'Reject'; rejectBtn.className = 'danger'; rejectBtn.style.marginLeft = '4px';
      guardClick(approveBtn, async function () {
        await api('reviewLessonReport', { lessonReportId: r.LessonReportID, decision: 'Approved', notes: notesInput.value });
        toast('Approved'); await renderLessonReportReviewQueue();
      });
      guardClick(rejectBtn, async function () {
        await api('reviewLessonReport', { lessonReportId: r.LessonReportID, decision: 'Rejected', notes: notesInput.value });
        toast('Rejected'); await renderLessonReportReviewQueue();
      });
      actionsTd.appendChild(notesInput); actionsTd.appendChild(approveBtn); actionsTd.appendChild(rejectBtn);
    } else {
      actionsTd.textContent = r.ReviewNotes || '—';
    }
    body.appendChild(tr);
  });
}

// ---- Past paper performance overview ---------------------------------------------
async function loadPastPaperPerformanceOverview() {
  const subjOpts = allSubjects.map(function (s) { return '<option value="' + s.SubjectID + '">' + s.SubjectName + '</option>'; }).join('');
  const filterSel = document.getElementById('ppOverviewSubject');
  if (filterSel.options.length <= 1) filterSel.insertAdjacentHTML('beforeend', subjOpts);
  filterSel.onchange = renderPastPaperPerformanceOverview;
  await renderPastPaperPerformanceOverview();
}

async function renderPastPaperPerformanceOverview() {
  const subjectId = document.getElementById('ppOverviewSubject').value;
  const rows = await api('getPastPaperPerformanceOverview', { subjectId: subjectId });
  const body = document.getElementById('ppOverviewBody');
  body.innerHTML = rows.length ? '' : '<tr><td colspan="7" class="muted">No past papers assigned yet</td></tr>';
  rows.forEach(function (r) {
    const recCls = r.recommendation === 'On track' ? 'pass' : (r.recommendation.indexOf('adjust') > -1 ? 'fail' : 'pending');
    const tr = document.createElement('tr');
    tr.innerHTML = '<td>' + r.studentName + '</td><td>' + r.classTeacher + '</td><td>' + r.subjectName + '</td>' +
      '<td>' + r.paperTitle + ' (' + r.paperType + ', ' + r.year + ')</td><td>' + fmtDate(r.dateAssigned) + '</td>' +
      '<td>' + r.score + '</td><td><span class="badge ' + recCls + '">' + r.recommendation + '</span></td>';
    body.appendChild(tr);
  });
}

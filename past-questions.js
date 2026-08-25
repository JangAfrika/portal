const me = requirePage(); // any logged-in role can browse; only Students can attempt/submit
const dashByRole = { Admin: 'admin.html', Staff: 'staff.html', Student: 'student.html', Parent: 'parent.html' };
document.getElementById('backLink').href = dashByRole[me.Role] || 'index.html';

let subjects = [], currentSubjectId = null, currentYear = null, currentPaper = null;

async function init() {
  subjects = await api('listSubjects', {});
  const container = document.getElementById('subjectButtons');
  container.innerHTML = '';
  subjects.forEach(function (s) {
    const btn = document.createElement('button');
    btn.textContent = s.SubjectName;
    btn.className = 'secondary';
    btn.onclick = function () { chooseSubject(s.SubjectID, s.SubjectName); };
    container.appendChild(btn);
  });
}
init();

function showStep(id) {
  ['stepSubjects', 'stepYears', 'stepPapers', 'stepObjective', 'stepTheory'].forEach(function (s) {
    document.getElementById(s).classList.toggle('hidden', s !== id);
  });
}

async function chooseSubject(subjectId, subjectName) {
  currentSubjectId = subjectId;
  document.getElementById('chosenSubjectName').textContent = subjectName;
  const papers = await api('listPastPapers', { subjectId: subjectId });
  const years = Array.from(new Set(papers.map(function (p) { return p.Year; }))).sort().reverse();
  const container = document.getElementById('yearButtons');
  container.innerHTML = years.length ? '' : '<p class="muted">No past papers uploaded for this subject yet.</p>';
  years.forEach(function (y) {
    const btn = document.createElement('button');
    btn.textContent = y;
    btn.className = 'secondary';
    btn.onclick = function () { chooseYear(y); };
    container.appendChild(btn);
  });
  showStep('stepYears');
}
document.getElementById('backToSubjects').addEventListener('click', function () { showStep('stepSubjects'); });

async function chooseYear(year) {
  currentYear = year;
  document.getElementById('chosenYearLabel').textContent = year + ' past papers';
  const papers = await api('listPastPapers', { subjectId: currentSubjectId, year: year });
  const container = document.getElementById('papersList');
  container.innerHTML = papers.length ? '' : '<p class="muted">No papers for this year.</p>';
  papers.forEach(function (p) {
    const card = document.createElement('div');
    card.className = 'card';
    card.style.background = '#f7faf8';
    card.innerHTML = '<h3>' + p.Title + '</h3><p class="muted">' + p.PaperType + (p.ExamSitting ? (' · ' + p.ExamSitting) : '') + '</p>';
    const btn = document.createElement('button');
    btn.textContent = p.PaperType === 'Objective' ? 'Attempt questions' : 'View / Download';
    btn.onclick = function () { openPaper(p); };
    card.appendChild(btn);
    container.appendChild(card);
  });
  showStep('stepPapers');
}
document.getElementById('backToYears').addEventListener('click', function () { chooseSubject(currentSubjectId, document.getElementById('chosenSubjectName').textContent); });

async function openPaper(paper) {
  currentPaper = paper;
  if (paper.PaperType === 'Objective') {
    await openObjective(paper);
  } else {
    document.getElementById('theoryTitle').textContent = paper.Title;
    showStep('stepTheory');
  }
}
document.getElementById('backToPapersFromObjective').addEventListener('click', function () { chooseYear(currentYear); });
document.getElementById('backToPapersFromTheory').addEventListener('click', function () { chooseYear(currentYear); });

async function openObjective(paper) {
  document.getElementById('objectiveTitle').textContent = paper.Title;
  const summaryEl = document.getElementById('attemptSummary');
  summaryEl.textContent = '';

  if (me.Role === 'Student') {
    try {
      const attempts = await api('getPastPaperAttempts', { paperId: paper.PaperID });
      if (attempts.firstTry) {
        let msg = 'First try: ' + attempts.firstTry.Percentage + '%. Latest: ' + attempts.latest.Percentage + '%.';
        if (attempts.progressVariation !== null) {
          const diff = attempts.progressVariation;
          msg += diff > 0 ? (' Improved by ' + diff + ' points since your last attempt! 🎉')
               : diff < 0 ? (' Down ' + Math.abs(diff) + ' points from your last attempt.')
               : ' Same as your last attempt.';
        }
        summaryEl.textContent = msg;
      }
    } catch (err) { /* no attempts yet, ignore */ }
  }

  const task = await api('getTask', { taskId: paper.TaskID });
  const questions = JSON.parse(task.QuestionsJSON);
  const container = document.getElementById('objectiveQuestions');
  container.innerHTML = '';
  questions.forEach(function (q, i) {
    const qDiv = document.createElement('div');
    qDiv.innerHTML = '<p><strong>' + (i + 1) + '. ' + q.q + '</strong></p>';
    q.choices.forEach(function (c, ci) {
      if (!c) return;
      const label = document.createElement('label');
      label.style.fontWeight = 'normal';
      label.innerHTML = '<input type="radio" name="pq_q' + i + '" value="' + ci + '"> ' + c;
      qDiv.appendChild(label);
    });
    container.appendChild(qDiv);
  });
  window._currentObjectiveQuestions = questions;
  document.getElementById('submitObjectiveBtn').style.display = (me.Role === 'Student') ? 'inline-block' : 'none';
  showStep('stepObjective');
}

guardClick(document.getElementById('submitObjectiveBtn'), async function () {
  const questions = window._currentObjectiveQuestions || [];
  const answers = questions.map(function (q, i) {
    const checked = document.querySelector('input[name="pq_q' + i + '"]:checked');
    return checked ? Number(checked.value) : -1;
  });
  const result = await api('submitTask', { taskId: currentPaper.TaskID, answers: JSON.stringify(answers) });
  toast('Score: ' + result.Percentage + '%');
  await openObjective(currentPaper); // refresh with the new attempt comparison
});

guardClick(document.getElementById('downloadTheoryBtn'), function () { return downloadPastPaperPdf(currentPaper.PaperID); });

guardClick(document.getElementById('downloadObjectiveBtn'), function () { return downloadPastPaperPdf(currentPaper.PaperID); });

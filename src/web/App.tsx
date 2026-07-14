import { useState } from 'react';
import { Navigate, Route, Routes, useParams } from 'react-router-dom';
import { SimProvider, useSimState } from './sim-context';
import { RepoHeader } from './components/RepoHeader';
import { DemoGuide } from './components/DemoGuide';
import { CodePage, CommitsPage } from './pages/CodePage';
import { BranchesPage } from './pages/BranchesPage';
import { IssuesPage, IssueDetailPage, NewIssuePage } from './pages/IssuesPage';
import { PullsPage, PullDetailPage } from './pages/PullsPage';
import { InboxPage } from './pages/InboxPage';
import { ActivityPage } from './pages/ActivityPage';
import { ConfigPage } from './pages/ConfigPage';

/** `#42` style references resolve to whichever entity owns the number. */
function RefRedirect() {
  const state = useSimState();
  const params = useParams();
  const number = Number(params.number);
  if (state.pulls[number]) return <Navigate to={`/pulls/${number}`} replace />;
  return <Navigate to={`/issues/${number}`} replace />;
}

function Shell() {
  const [guideOpen, setGuideOpen] = useState(false);
  return (
    <div className="app">
      <RepoHeader onToggleGuide={() => setGuideOpen((g) => !g)} guideOpen={guideOpen} />
      <Routes>
        <Route path="/" element={<Navigate to="/code" replace />} />
        <Route path="/code" element={<CodePage />} />
        <Route path="/code/*" element={<CodePage />} />
        <Route path="/commits" element={<CommitsPage />} />
        <Route path="/commits/*" element={<CommitsPage />} />
        <Route path="/branches" element={<BranchesPage />} />
        <Route path="/issues" element={<IssuesPage />} />
        <Route path="/issues/new" element={<NewIssuePage />} />
        <Route path="/issues/:number" element={<IssueDetailPage />} />
        <Route path="/pulls" element={<PullsPage />} />
        <Route path="/pulls/:number" element={<PullDetailPage />} />
        <Route path="/inbox" element={<InboxPage />} />
        <Route path="/activity" element={<ActivityPage />} />
        <Route path="/config" element={<ConfigPage />} />
        <Route path="/ref/:number" element={<RefRedirect />} />
        <Route path="*" element={<Navigate to="/code" replace />} />
      </Routes>
      {guideOpen ? <DemoGuide onClose={() => setGuideOpen(false)} /> : null}
    </div>
  );
}

export function App() {
  return (
    <SimProvider>
      <Shell />
    </SimProvider>
  );
}

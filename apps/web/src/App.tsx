import type { ReactNode } from 'react';
import { NavLink, Route, Routes } from 'react-router-dom';
import Dashboard from './pages/Dashboard';
import Opportunities from './pages/Opportunities';
import OpportunityDetail from './pages/OpportunityDetail';
import Milestones from './pages/Milestones';
import MilestoneDetail from './pages/MilestoneDetail';
import Approvals from './pages/Approvals';
import AuditLog from './pages/AuditLog';
import ChatWidget from './components/ChatWidget';
import { AuthMenu } from './auth/AuthMenu';
import { authEnabled } from './auth/msalConfig';

// Crisp Fluent-style line icons (stroke = currentColor so they inherit nav colors).
const icon = (paths: ReactNode): ReactNode => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {paths}
  </svg>
);

const navItems: { to: string; label: string; end?: boolean; icon: ReactNode }[] = [
  { to: '/', label: 'Dashboard', end: true, icon: icon(<><rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" /></>) },
  { to: '/opportunities', label: 'Opportunities', icon: icon(<><rect x="3" y="7" width="18" height="13" rx="2" /><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><path d="M3 12h18" /></>) },
  { to: '/milestones', label: 'Milestones', icon: icon(<><path d="M5 21V4" /><path d="M5 4h11l-2 3 2 3H5" /></>) },
  { to: '/approvals', label: 'Approvals', icon: icon(<><path d="M9 12l2 2 4-4" /><circle cx="12" cy="12" r="9" /></>) },
  { to: '/audit', label: 'Agent Audit Log', icon: icon(<><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 8h8M8 12h8M8 16h5" /></>) },
];

export default function App() {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3l1.9 4.7L19 9.5l-4.1 2.9L16 18l-4-2.9L8 18l1.1-5.6L5 9.5l5.1-1.8L12 3z" />
            </svg>
          </span>
          <span className="brand-text">
            <strong>MSX Milestone</strong>
            <small>Assistant · Solution Engineering</small>
          </span>
        </div>
        <nav className="nav">
          {navItems.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end} title={item.label}>
              <span className="nav-icon">{item.icon}</span>
              <span className="nav-label">{item.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-foot">
          <span className="chip chip-mock">
            <span className="dot" aria-hidden="true" /> Mock data
          </span>
        </div>
      </aside>

      <div className="main-area">
        <header className="topbar">
          <div className="topbar-title">Solution Engineering Workspace</div>
          <div className="topbar-actions">
            <span className="chip">Synthetic · no real data</span>
            {authEnabled ? <AuthMenu /> : <span className="avatar" aria-hidden="true">SE</span>}
          </div>
        </header>
        <main className="content">
          <div className="mock-banner">
            Mock environment — no connection to real MSX, Dataverse, or customer data. All records are synthetic.
          </div>
          <div className="page-body">
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/opportunities" element={<Opportunities />} />
              <Route path="/opportunities/:id" element={<OpportunityDetail />} />
              <Route path="/milestones" element={<Milestones />} />
              <Route path="/milestones/:id" element={<MilestoneDetail />} />
              <Route path="/approvals" element={<Approvals />} />
              <Route path="/audit" element={<AuditLog />} />
            </Routes>
          </div>
        </main>
      </div>
      <ChatWidget />
    </div>
  );
}

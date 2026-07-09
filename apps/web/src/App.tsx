import { NavLink, Route, Routes } from 'react-router-dom';
import Dashboard from './pages/Dashboard';
import Opportunities from './pages/Opportunities';
import OpportunityDetail from './pages/OpportunityDetail';
import Milestones from './pages/Milestones';
import MilestoneDetail from './pages/MilestoneDetail';
import Approvals from './pages/Approvals';
import AuditLog from './pages/AuditLog';

const navItems = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/opportunities', label: 'Opportunities' },
  { to: '/milestones', label: 'Milestones' },
  { to: '/approvals', label: 'Approvals' },
  { to: '/audit', label: 'Agent Audit Log' },
];

export default function App() {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          MSX Milestone Assistant
          <small>Synthetic mock · Solution Engineering</small>
        </div>
        <nav>
          {navItems.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end}>
              {item.label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <main className="content">
        <div className="mock-banner">
          Mock environment — no connection to real MSX, Dataverse, or customer data. All records are synthetic.
        </div>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/opportunities" element={<Opportunities />} />
          <Route path="/opportunities/:id" element={<OpportunityDetail />} />
          <Route path="/milestones" element={<Milestones />} />
          <Route path="/milestones/:id" element={<MilestoneDetail />} />
          <Route path="/approvals" element={<Approvals />} />
          <Route path="/audit" element={<AuditLog />} />
        </Routes>
      </main>
    </div>
  );
}

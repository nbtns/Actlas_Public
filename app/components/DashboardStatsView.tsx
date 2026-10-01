'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { IconDollarSign, IconClock, IconActivity, IconUsers, IconTrash2 } from '../Icons';

interface StatData {
  id: string;
  name: string;
  email: string;
  totalSales: number;
  totalDuration: number;
  apiCost: number;
  studentCount: number;
  lessonCount: number;
  systemFeeRate: number;
  menuStats: { id: string; name: string; count: number; sales: number }[];
  availableMonths: string[];
  students: { id: string; name: string }[];
  menus: { id: string; name: string; price: number }[];
}

interface DashboardResponse {
  stats: StatData[];
}

interface DashboardStatsViewProps {
  language?: string;
}

export default function DashboardStatsView({ language = 'ja' }: DashboardStatsViewProps) {
  
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const now = new Date();
  const currentMonthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const [selectedMonth, setSelectedMonth] = useState<string>(currentMonthStr);
  
  const getLocalDatetimeLocalString = () => {
    const now = new Date();
    const tzOffset = now.getTimezoneOffset() * 60000;
    return new Date(now.getTime() - tzOffset).toISOString().slice(0, 16);
  };

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [manualRecordState, setManualRecordState] = useState({
    studentId: '',
    menuId: '',
    amountPaid: 0,
    targetDate: getLocalDatetimeLocalString()
  });

  const fetchStats = useCallback(() => {
    setLoading(true);
    fetch(`/api/dashboard/stats?month=${selectedMonth}`)
      .then(res => {
        if (!res.ok) throw new Error('データの取得に失敗しました');
        return res.json();
      })
      .then(d => {
        setData(d);
        setLoading(false);
      })
      .catch((err: unknown) => {
        console.error('Fetch stats error:', err);
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });
  }, [selectedMonth]);

  const handleDeleteRecord = async (menuId: string, menuName: string) => {
    if (!window.confirm(`「${menuName}」の最新の完了記録を1件取り消しますか？\n（直近に追加された1件が削除されます）`)) return;

    try {
      const res = await fetch('/api/dashboard/manual-record', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ menuId, month: selectedMonth })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '削除に失敗しました');
      
      // 再取得して画面更新
      fetchStats();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : String(err));
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchStats();
  }, [fetchStats]);

  const handleManualRecordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/dashboard/manual-record', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(manualRecordState)
      });
      if (!res.ok) {
        throw new Error('追加に失敗しました');
      }
      setIsModalOpen(false);
      fetchStats();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : String(err));
    }
  };

  if (loading && !data) {
    return (
      <div className="dashboard-stats dashboard-stats--loading">
        <div className="dashboard-stats__spinner"></div>
        <p>{language === 'en' ? 'Compiling data...' : 'データを集計中...'}</p>
      </div>
    );
  }

  if (error || !data || data.stats.length === 0) {
    return (
      <div className="dashboard-stats dashboard-stats--error">
        <p>{error || (language === 'en' ? 'No data available' : 'データがありません')}</p>
      </div>
    );
  }

  const stat = data.stats[0];

  const systemFeeRate = stat.systemFeeRate ?? 15;
  const systemFee = stat.totalSales * (systemFeeRate / 100);
  const totalProfit = stat.totalSales - systemFee;

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
  };

  const handleMenuChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const menuId = e.target.value;
    const menu = stat.menus.find(m => m.id === menuId);
    setManualRecordState(prev => ({
      ...prev,
      menuId,
      amountPaid: menu ? menu.price : prev.amountPaid
    }));
  };

  const formatMonth = (monthStr: string) => {
    const [year, month] = monthStr.split('-');
    return language === 'en' ? `${year}-${month}` : `${year}年${parseInt(month, 10)}月`;
  };

  return (
    <div className="dashboard-stats-container">
      <div className="dashboard-stats__header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h2 className="dashboard-stats__title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <IconActivity size={28} /> {language === 'en' ? 'Usage & Revenue' : '利用料・売上'}
          </h2>
          <p className="dashboard-stats__subtitle">
            {language === 'en' ? 'Usage & Revenue Report' : '利用状況・売上レポート'}
          </p>
        </div>
        <div>
          <select 
            value={selectedMonth} 
            onChange={e => setSelectedMonth(e.target.value)}
            className="month-selector"
          >
            {stat.availableMonths.map(m => (
              <option key={m} value={m}>{formatMonth(m)}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="dashboard-stats__summary-container">
        <div className="dashboard-stats__column">
          <div className="dashboard-stats__card dashboard-stats__card--sales">
            <div className="card-icon"><IconDollarSign size={24} /></div>
            <div className="card-content">
              <h3>{language === 'en' ? 'Total Sales' : '対象月の売上'}</h3>
              <div className="card-value">{formatCurrency(stat.totalSales)}</div>
            </div>
          </div>
          <div className="dashboard-stats__card dashboard-stats__card--profit" style={{ background: 'rgba(52, 211, 153, 0.1)' }}>
            <div className="card-icon" style={{ color: '#34d399', background: 'rgba(52, 211, 153, 0.2)' }}><IconDollarSign size={24} /></div>
            <div className="card-content">
              <h3 style={{ color: '#34d399' }}>{language === 'en' ? 'After Platform Fee' : 'システム利用料控除後'}</h3>
              <div className="card-value" style={{ color: '#34d399' }}>{formatCurrency(totalProfit)}</div>
              <p className="card-note" style={{ fontSize: '0.8rem', color: '#6ee7b7', marginTop: '4px' }}>
                {language === 'en' 
                  ? `*After ${systemFeeRate}% Actlas platform fee. Stripe fees are shown separately in Stripe.`
                  : `※Actlasシステム利用料${systemFeeRate}%の控除後。Stripe手数料はStripe側で別途表示されます。`}
              </p>
            </div>
          </div>
        </div>
        <div className="dashboard-stats__column">
          <div className="dashboard-stats__card dashboard-stats__card--duration">
            <div className="card-icon"><IconClock size={24} /></div>
            <div className="card-content">
              <h3>{language === 'en' ? 'Total Lessons' : 'レッスン回数'}</h3>
              <div className="card-value">{stat.lessonCount} <span className="text-sm">{language === 'en' ? 'times' : '回'}</span></div>
            </div>
          </div>
          <div className="dashboard-stats__card dashboard-stats__card--users">
            <div className="card-icon"><IconUsers size={24} /></div>
            <div className="card-content">
              <h3>{language === 'en' ? 'Assigned Students' : '担当生徒数'}</h3>
              <div className="card-value">{stat.studentCount} <span className="text-sm">{language === 'en' ? 'students' : '人'}</span></div>
            </div>
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
        <h3 className="section-title" style={{ marginBottom: 0 }}>
          {language === 'en' ? 'Sales by Menu' : 'メニュー別売上・回数'}
        </h3>
        <button 
          className="manual-add-btn"
          onClick={() => {
            setManualRecordState(prev => ({ ...prev, targetDate: getLocalDatetimeLocalString() }));
            setIsModalOpen(true);
          }}
        >
          {language === 'en' ? '+ Manual Add' : '＋ 手動追加'}
        </button>
      </div>

      <div className="table-wrapper">
        <table className="stats-table">
          <thead>
            <tr>
              <th>{language === 'en' ? 'Menu Name' : 'メニュー名'}</th>
              <th className="text-right">{language === 'en' ? 'Count' : '回数'}</th>
              <th className="text-right">{language === 'en' ? 'Sales' : '売上'}</th>
            </tr>
          </thead>
          <tbody>
            {stat.menuStats.length > 0 ? stat.menuStats.map(menu => (
              <tr key={menu.id}>
                <td className="font-medium">{menu.name}</td>
                <td className="text-right" style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '8px' }}>
                  {menu.count}回
                  {menu.count > 0 && (
                    <button 
                      onClick={() => handleDeleteRecord(menu.id, menu.name)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444', padding: '4px', display: 'flex', alignItems: 'center' }}
                      title="最新の1件を取り消す"
                    >
                      <IconTrash2 size={16} />
                    </button>
                  )}
                </td>
                <td className="text-right">{formatCurrency(menu.sales)}</td>
              </tr>
            )) : (
              <tr>
                <td colSpan={3} className="text-center text-gray-500 py-8">
                  {language === 'en' ? 'No menu data available' : 'データがありません'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {isModalOpen && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h3 className="modal-title">{language === 'en' ? 'Manual Lesson Record' : 'レッスン手動追加'}</h3>
            <form onSubmit={handleManualRecordSubmit}>
              <div className="form-group">
                <label>{language === 'en' ? 'Student' : '生徒'}</label>
                <select 
                  required
                  value={manualRecordState.studentId}
                  onChange={e => setManualRecordState(prev => ({ ...prev, studentId: e.target.value }))}
                >
                  <option value="">{language === 'en' ? 'Select Student' : '生徒を選択'}</option>
                  {stat.students.map(s => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label>{language === 'en' ? 'Lesson Menu' : 'レッスンメニュー'}</label>
                <select 
                  required
                  value={manualRecordState.menuId}
                  onChange={handleMenuChange}
                >
                  <option value="">{language === 'en' ? 'Select Menu' : 'メニューを選択'}</option>
                  {stat.menus.map(m => (
                    <option key={m.id} value={m.id}>{m.name}</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label>{language === 'en' ? 'Amount Paid (USD)' : '売上金額（$）'}</label>
                <input 
                  type="number" 
                  required
                  min="0"
                  step="1"
                  value={manualRecordState.amountPaid}
                  onChange={e => setManualRecordState(prev => ({ ...prev, amountPaid: parseInt(e.target.value, 10) || 0 }))}
                />
              </div>
              <div className="form-group">
                <label>{language === 'en' ? 'Date & Time' : '実施日時'}</label>
                <input 
                  type="datetime-local" 
                  required
                  value={manualRecordState.targetDate}
                  onChange={e => setManualRecordState(prev => ({ ...prev, targetDate: e.target.value }))}
                />
              </div>
              <div className="modal-actions">
                <button type="button" className="btn-cancel" onClick={() => setIsModalOpen(false)}>
                  {language === 'en' ? 'Cancel' : 'キャンセル'}
                </button>
                <button type="submit" className="btn-submit">
                  {language === 'en' ? 'Add Record' : '追加する'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <style jsx>{`
        .dashboard-stats-container {
          padding: 2rem 3rem;
          width: 100%;
          color: #f1f5f9;
          animation: fadeIn 0.4s ease;
          height: 100%;
          overflow-y: auto;
        }
        .dashboard-stats__header {
          margin-bottom: 2rem;
        }
        .dashboard-stats__title {
          font-size: 1.75rem;
          font-weight: 700;
          color: #fff;
          margin-bottom: 0.5rem;
        }
        .dashboard-stats__subtitle {
          color: #94a3b8;
          font-size: 0.95rem;
        }
        
        .month-selector {
          background: rgba(39, 39, 42, 0.8);
          border: 1px solid rgba(255, 255, 255, 0.1);
          color: white;
          padding: 0.5rem 1rem;
          border-radius: 8px;
          font-size: 1rem;
          cursor: pointer;
          outline: none;
        }
        .month-selector:focus {
          border-color: #fb923c;
        }
        .month-selector option {
          background-color: #18181b;
          color: white;
        }

        .dashboard-stats__summary-container {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 1.5rem;
          margin-bottom: 3rem;
          align-items: start;
        }
        @media (max-width: 768px) {
          .dashboard-stats__summary-container {
            grid-template-columns: 1fr;
          }
        }
        .dashboard-stats__column {
          display: flex;
          flex-direction: column;
          gap: 1.5rem;
        }
        .dashboard-stats__card {
          background: rgba(39, 39, 42, 0.6);
          border: 1px solid rgba(255, 255, 255, 0.05);
          border-radius: 16px;
          padding: 1.5rem;
          display: flex;
          align-items: center;
          gap: 1.25rem;
          box-shadow: 0 4px 24px -6px rgba(0, 0, 0, 0.3);
          backdrop-filter: blur(12px);
          transition: transform 0.2s;
        }
        .dashboard-stats__card:hover {
          transform: translateY(-2px);
        }
        .card-icon {
          width: 54px;
          height: 54px;
          border-radius: 14px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: rgba(255, 255, 255, 0.05);
        }
        .dashboard-stats__card--sales .card-icon { color: #34d399; background: rgba(52, 211, 153, 0.15); }
        .dashboard-stats__card--cost .card-icon { color: #f87171; background: rgba(248, 113, 113, 0.15); }
        .dashboard-stats__card--duration .card-icon { color: #fb923c; background: rgba(251, 146, 60, 0.15); }
        .dashboard-stats__card--users .card-icon { color: #d4d4d8; background: rgba(212, 212, 216, 0.15); }

        .card-content h3 {
          font-size: 0.85rem;
          color: #94a3b8;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          margin-bottom: 0.25rem;
          font-weight: 600;
        }
        .card-value {
          font-size: 1.8rem;
          font-weight: 700;
          color: #fff;
        }
        .text-sm { font-size: 1rem; color: #94a3b8; font-weight: normal; }

        .section-title {
          font-size: 1.25rem;
          font-weight: 600;
          color: #f1f5f9;
        }
        
        .manual-add-btn {
          background: #fb923c;
          color: white;
          border: none;
          padding: 0.5rem 1rem;
          border-radius: 8px;
          font-weight: 600;
          cursor: pointer;
          transition: background 0.2s;
        }
        .manual-add-btn:hover {
          background: #f97316;
        }

        .table-wrapper {
          background: rgba(39, 39, 42, 0.6);
          border: 1px solid rgba(255, 255, 255, 0.05);
          border-radius: 16px;
          overflow: hidden;
          backdrop-filter: blur(12px);
          margin-bottom: 3rem;
        }
        .stats-table {
          width: 100%;
          border-collapse: collapse;
        }
        .stats-table th {
          background: rgba(0, 0, 0, 0.2);
          padding: 1rem 1.5rem;
          text-align: left;
          font-size: 0.85rem;
          color: #94a3b8;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          border-bottom: 1px solid rgba(255, 255, 255, 0.05);
        }
        .stats-table td {
          padding: 1.25rem 1.5rem;
          border-bottom: 1px solid rgba(255, 255, 255, 0.05);
          vertical-align: middle;
        }
        .stats-table tr:last-child td { border-bottom: none; }
        .stats-table tr:hover { background: rgba(255, 255, 255, 0.02); }

        .text-right { text-align: right; }
        .text-center { text-align: center; }
        .font-medium { font-weight: 500; }
        .text-gray-500 { color: #64748b; }
        .py-8 { padding-top: 2rem; padding-bottom: 2rem; }

        .dashboard-stats--loading, .dashboard-stats--error {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          height: 100%;
          min-height: 400px;
          color: #94a3b8;
        }
        .dashboard-stats__spinner {
          width: 40px;
          height: 40px;
          border: 3px solid rgba(255,255,255,0.1);
          border-top-color: #fb923c;
          border-radius: 50%;
          animation: spin 1s linear infinite;
          margin-bottom: 1rem;
        }
        
        .modal-overlay {
          position: fixed;
          top: 0; left: 0; right: 0; bottom: 0;
          background: rgba(0, 0, 0, 0.7);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 1000;
        }
        .modal-content {
          background: #18181b;
          border: 1px solid rgba(255,255,255,0.1);
          padding: 2rem;
          border-radius: 16px;
          width: 400px;
          max-width: 90%;
          box-shadow: 0 10px 30px rgba(0,0,0,0.5);
        }
        .modal-title {
          font-size: 1.25rem;
          margin-bottom: 1.5rem;
          font-weight: 600;
        }
        .form-group {
          margin-bottom: 1.25rem;
        }
        .form-group label {
          display: block;
          margin-bottom: 0.5rem;
          font-size: 0.9rem;
          color: #94a3b8;
        }
        .form-group select, .form-group input {
          width: 100%;
          padding: 0.75rem;
          background: rgba(255,255,255,0.05);
          border: 1px solid rgba(255,255,255,0.1);
          color: white;
          border-radius: 8px;
        }
        .form-group select:focus, .form-group input:focus {
          border-color: #fb923c;
          outline: none;
        }
        .form-group select option {
          background-color: #18181b;
          color: white;
        }
        .modal-actions {
          display: flex;
          justify-content: flex-end;
          gap: 1rem;
          margin-top: 2rem;
        }
        .btn-cancel {
          background: transparent;
          color: #94a3b8;
          border: none;
          cursor: pointer;
        }
        .btn-cancel:hover {
          color: white;
        }
        .btn-submit {
          background: #fb923c;
          color: white;
          border: none;
          padding: 0.5rem 1.5rem;
          border-radius: 8px;
          font-weight: 600;
          cursor: pointer;
        }
        .btn-submit:hover {
          background: #f97316;
        }

        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>
    </div>
  );
}

const Evidence = require('../models/Evidence');
const Verification = require('../models/Verification');
const User = require('../models/User');
const Block = require('../models/Block');
const AuditLog = require('../models/AuditLog');
const SystemStatus = require('../models/SystemStatus');
const { can } = require('../config/permissions');

const getDashboardStats = async (req, res, next) => {
  try {
    const role = req.user.role;
    const isAdmin = role === 'ADMIN';
    const canViewAudit = can(role, 'viewAudit');
    const canViewBlockchain = can(role, 'viewBlockchain');

    // Build 7 calendar days (YYYY-MM-DD) ending today
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setUTCDate(d.getUTCDate() - i);
      days.push(d.toISOString().split('T')[0]);
    }
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setUTCDate(sevenDaysAgo.getUTCDate() - 6);
    sevenDaysAgo.setUTCHours(0, 0, 0, 0);

    // Queries to run in parallel
    const queries = [
      // 0: Evidence counts
      Evidence.countDocuments({ isDeleted: false }),
      Evidence.countDocuments({ isDeleted: false, status: 'Verified' }),
      Evidence.countDocuments({ isDeleted: false, status: 'Pending' }),
      Evidence.countDocuments({ isDeleted: false, status: 'Tampered' }),

      // 4: Verification counts & 7-day aggregation
      Verification.countDocuments(),
      Verification.countDocuments({ result: 'VERIFIED' }),
      Verification.countDocuments({ result: 'TAMPERED' }),
      Verification.aggregate([
        { $match: { verifiedAt: { $gte: sevenDaysAgo } } },
        {
          $group: {
            _id: {
              date: { $dateToString: { format: "%Y-%m-%d", date: "$verifiedAt" } },
              result: "$result"
            },
            count: { $sum: 1 }
          }
        }
      ]),

      // 8: Recent Evidence (5 latest non-deleted)
      Evidence.find({ isDeleted: false })
        .sort({ createdAt: -1 })
        .limit(5)
        .select('evidenceId caseId name type status createdAt isDemo -_id')
        .lean(),

      // 9: Users count (ADMIN only)
      isAdmin ? User.countDocuments() : Promise.resolve(null),

      // 10: Audit count (ADMIN, INVESTIGATOR)
      canViewAudit ? AuditLog.countDocuments() : Promise.resolve(null),

      // 11: Recent Activity (8 latest audit events, NO ipAddress)
      canViewAudit ? AuditLog.find()
        .sort({ timestamp: -1 })
        .limit(8)
        .select('action userName role description timestamp -_id')
        .lean() : Promise.resolve(null),

      // 12: Blocks count (roles with viewBlockchain)
      canViewBlockchain ? Block.countDocuments() : Promise.resolve(null),

      // 13: System status validation cache (roles with viewBlockchain)
      canViewBlockchain ? SystemStatus.findOne({ key: 'chainValidation' }).lean() : Promise.resolve(null)
    ];

    const [
      totalEv, verifiedEv, pendingEv, tamperedEv,
      totalVer, verifiedVer, tamperedVer, verAggr,
      recentEv,
      usersTotal,
      auditEventsTotal,
      recentAct,
      blocksTotal,
      sysValidation
    ] = await Promise.all(queries);

    // Process 7-day zero-filled aggregation
    const dayMap = {};
    days.forEach(day => {
      dayMap[day] = { date: day, verified: 0, tampered: 0 };
    });
    if (Array.isArray(verAggr)) {
      verAggr.forEach(item => {
        if (item._id && item._id.date && dayMap[item._id.date]) {
          if (item._id.result === 'VERIFIED') dayMap[item._id.date].verified += item.count;
          if (item._id.result === 'TAMPERED') dayMap[item._id.date].tampered += item.count;
        }
      });
    }
    const last7Days = days.map(d => dayMap[d]);

    // Process chain info
    let chainInfo = null;
    if (canViewBlockchain && blocksTotal !== null) {
      const lastValidation = sysValidation ? sysValidation.value : null;
      const blocksChecked = lastValidation && typeof lastValidation.blocksChecked === 'number' ? lastValidation.blocksChecked : 0;
      const blocksSinceValidation = lastValidation ? Math.max(0, blocksTotal - blocksChecked) : blocksTotal;
      chainInfo = {
        lastValidation,
        blocksSinceValidation
      };
    }

    const responseData = {
      evidence: {
        total: totalEv,
        verified: verifiedEv,
        pending: pendingEv,
        tampered: tamperedEv
      },
      verificationStats: {
        total: totalVer,
        verified: verifiedVer,
        tampered: tamperedVer,
        last7Days
      },
      users: usersTotal,
      auditEvents: auditEventsTotal,
      blocks: blocksTotal,
      chain: chainInfo,
      recentEvidence: recentEv,
      recentActivity: recentAct,
      generatedAt: new Date().toISOString()
    };

    return res.json({
      success: true,
      data: responseData
    });
  } catch (err) {
    console.error('[DASHBOARD STATS ERROR]', err);
    return res.status(500).json({ success: false, code: 'SERVER_ERROR', message: 'Failed to retrieve dashboard stats' });
  }
};

module.exports = {
  getDashboardStats
};

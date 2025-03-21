import express from 'express';
const router = express.Router();
import config from '../../config.js';

const db = config.mySqlDriver;

router.get('/', async (req, res) => {
  const { startDate, endDate } = req.query;

  try {
    // Validate date range
    if (!startDate || !endDate) {
      return res
        .status(400)
        .json({ success: false, message: 'Invalid date range.' });
    }

    const stats = {};

    // 1. Total Borrowers
    const [borrowerCount] = await db.query(
      `SELECT COUNT(*) AS totalBorrowers 
       FROM borrower_account 

       
       `,
      [startDate, endDate]
    );
    stats.totalBorrowers = borrowerCount[0].totalBorrowers;

    // 2. Loan Statistics
    const [loanStats] = await db.query(
      `SELECT loan_status, COUNT(*) AS count, SUM(loan_amount) AS totalAmount 
       FROM loan 
       WHERE application_date BETWEEN ? AND ?
       GROUP BY loan_status`,
      [startDate, endDate]
    );
    stats.loanStats = loanStats;

    // 3. Disbursement Statistics
    const [disbursementStats] = await db.query(
      `SELECT COUNT(*) AS totalDisbursements, SUM(amount) AS totalDisbursed 
       FROM disbursement_details 
       WHERE disbursement_date BETWEEN ? AND ?`,
      [startDate, endDate]
    );
    stats.disbursementStats = disbursementStats[0];

    res.status(200).json({ success: true, data: stats });
  } catch (err) {
    console.log({
      err
    });
    res
      .status(500)
      .json({ success: false, message: 'An error occurred: ' + err.message });
  }
});

router.get('/loan_interest_income', async (req, res) => {
  const { startDate, endDate } = req.query;

  // Validate required query parameters
  if (!startDate || !endDate) {
    return res
      .status(400)
      .json({ error: 'startDate and endDate are required' });
  }

  try {
    // Query to fetch loan interest income data
    const [rows] = await db.query(
      `

SELECT DATE(approval_date) AS date, 
       ROUND(SUM(loan_amount * (interest_rate / 100)), 2) AS totalInterestIncome
FROM loan
WHERE approval_date BETWEEN ? AND ?

AND loan_status = 'Approved'
GROUP BY DATE(approval_date)
ORDER BY DATE(approval_date) ASC;
       
       `,
      [startDate, endDate]
    );

    // Respond with the data
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error fetching data' });
  }
});

export default router;

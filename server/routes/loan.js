import express from 'express';

import config from '../config.js';

import {
  authenticateUserMiddleware,
  auditTrailMiddleware
} from '../middleware/authMiddleware.js';

let db = config.mySqlDriver;
import { v4 as uuidv4 } from 'uuid';
const router = express.Router();

import multer from 'multer';
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed!'));
    }
  }
});
let firebaseStorage = config.firebaseStorage;
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';

const accountSid = 'ACbe246063583580e176da8274a8071c4a'; // Replace with your Twilio Account SID
const authToken = 'faa226819bb25872991f707ec4e2d2d2'; // Replace with your Twilio Auth Token
import twilio from 'twilio'; // Use import statement for Twilio
import { Vonage } from '@vonage/server-sdk';

const vonage = new Vonage({
  apiKey: config.VONAGE_apiKey,
  apiSecret: config.VONAGE_apiSecret
});

const loanCreationMessage = ({
  firstName,
  lastName,
  loanAmount,
  loanId
}) => `Dear ${firstName} ${lastName},

Your loan application (Loan ID: ${loanId}) for the amount of ${loanAmount} has been successfully created. Our team will review your application and get back to you shortly.

Thank you for choosing us!`;

const sendMessage = async ({
  firstName,
  lastName,
  phoneNumber,
  messageType,
  additionalData = {}
}) => {
  const client = twilio(accountSid, authToken);
  const templates = {
    loanCreation: loanCreationMessage
  };

  const text = templates[messageType]
    ? templates[messageType]({ firstName, lastName, ...additionalData })
    : 'No valid message type provided.';

  const from = 'YourCompany'; // Set your company name or short code as sender
  const to = phoneNumber;

  try {
    // await vonage.sms.send(
    //   { to, from, text: messageText },
    //   (error, response) => {
    //     if (error) {
    //       console.error('Failed to send message:', error);
    //     } else {
    //       console.log('Message sent successfully:', response);
    //     }
    //   }
    // );
    console.log({ to, from, text });
    await vonage.sms.send({ to, from, text }).then(resp => {
      console.log('Message sent successfully');
      console.log(resp);
    });
  } catch (error) {
    console.error('Error occurred while sending message:', error);
  }
};

// Function to evaluate loan application with detailed breakdown and explanations
const evaluateLoanApplicationWithDetailedBreakdown = (
  application,
  parameters
) => {
  const { creditScore, monthlyIncome, loanAmount, employmentYears } =
    application;
  const {
    minCreditScore,
    minMonthlyIncome,
    maxLoanToIncomeRatio,
    minEmploymentYears
  } = parameters;

  // Calculate credit score percentage
  const creditScorePercentage =
    creditScore >= minCreditScore ? 100 : (creditScore / minCreditScore) * 100;
  const creditScoreMessage =
    creditScore >= minCreditScore
      ? 'Credit score meets the required threshold.'
      : `Credit score is lower than the required minimum of ${minCreditScore}. (${creditScorePercentage.toFixed(
          2
        )}%)`;

  // Calculate income percentage
  const incomePercentage =
    monthlyIncome >= minMonthlyIncome
      ? 100
      : (monthlyIncome / minMonthlyIncome) * 100;
  const incomeMessage =
    monthlyIncome >= minMonthlyIncome
      ? 'Income meets the required minimum.'
      : `Income is below the required minimum of ${minMonthlyIncome}. (${incomePercentage.toFixed(
          2
        )}%)`;

  // Calculate loan-to-income ratio percentage
  const maxLoanAmount = monthlyIncome * 12 * maxLoanToIncomeRatio;
  const loanToIncomePercentage =
    loanAmount <= maxLoanAmount ? 100 : (maxLoanAmount / loanAmount) * 100;
  const loanToIncomeMessage =
    loanAmount <= maxLoanAmount
      ? 'Loan amount is within the acceptable loan-to-income ratio.'
      : `Loan amount exceeds the allowed limit based on income (${loanToIncomePercentage.toFixed(
          2
        )}%).`;

  // Calculate employment years percentage
  const employmentYearsPercentage =
    employmentYears >= minEmploymentYears
      ? 100
      : (employmentYears / minEmploymentYears) * 100;
  const employmentYearsMessage =
    employmentYears >= minEmploymentYears
      ? 'Employment history meets the required duration.'
      : `Employment history is below the required minimum of ${minEmploymentYears} years. (${employmentYearsPercentage.toFixed(
          2
        )}%)`;

  // Final approval decision based on the lowest percentage
  const overallApprovalPercentage = Math.min(
    creditScorePercentage,
    incomePercentage,
    loanToIncomePercentage,
    employmentYearsPercentage
  );

  // Construct approval/denial message
  let approvalMessage = 'Loan application approved.';

  if (overallApprovalPercentage < 100) {
    approvalMessage =
      'Loan application denied due to the following criteria not meeting the required thresholds:';
  }

  return {
    approved: overallApprovalPercentage === 100,
    message: approvalMessage,
    breakdown: {
      creditScore: {
        percentage: creditScorePercentage,
        message: creditScoreMessage
      },
      income: {
        percentage: incomePercentage,
        message: incomeMessage
      },
      loanToIncomeRatio: {
        percentage: loanToIncomePercentage,
        message: loanToIncomeMessage
      },
      employmentYears: {
        percentage: employmentYearsPercentage,
        message: employmentYearsMessage
      }
    },
    overallApprovalPercentage
  };
};

const getBorrowerAccountByUserAccountId = async userId => {
  const [rows] = await db.query(
    `

SELECT borrower_id  FROM user_account WHERE user_id = ? 
      
       
       `,
    [userId]
  );

  return rows[0].borrower_id;
};

router.post('/checkLoanApplicationApprovalRate', async (req, res) => {
  let loan_application_id = req.body.loan_application_id; // User loan application details
  let application = req.body.application; // User loan application details
  const loanType = req.body.loanType; // Example: "personal", "business", "mortgage"

  try {
    const [rows] = await db.query(
      `
  
 SELECT b.*, l.loan_amount
  FROM borrower_account b JOIN loan l ON b.borrower_id = l.borrower_id 
 WHERE l.loan_id = ?;
        
         
         `,
      [loan_application_id]
    );

    // Default parameters for loan evaluation
    const loanParameters = {
      personal: {
        minCreditScore: 700,
        minMonthlyIncome: 15000,
        maxLoanToIncomeRatio: 0.5,
        minEmploymentYears: 2
      }
    };

    // Select parameters based on loan type
    const selectedParameters =
      loanParameters[loanType] || loanParameters['personal'];

    // // Validate application input
    // if (
    //   !application ||
    //   !application.creditScore ||
    //   !application.monthlyIncome ||
    //   !application.loanAmount ||
    //   application.employmentYears === undefined
    // ) {
    //   return res.status(400).json({
    //     error:
    //       'Provide all required fields: creditScore, monthlyIncome, loanAmount, employmentYears.'
    //   });
    // }

    // Evaluate the loan application with detailed breakdown

    let borrowerInfo = rows[0];

    application = {
      creditScore: borrowerInfo.credit_score,
      monthlyIncome: borrowerInfo.monthly_income,
      loanAmount: borrowerInfo.loan_amount,
      employmentYears: borrowerInfo.employment_years
    };
    const result = evaluateLoanApplicationWithDetailedBreakdown(
      application,
      selectedParameters
    );

    res.status(201).json({
      success: true,
      data: {
        result
      }
    });
  } catch (err) {
    console.error(err); // Log the error for debugging
    res.status(500).json({
      success: false,
      message: 'An error occurred. Please try again later.'
    });
  }
});
router.post(
  '/create',
  authenticateUserMiddleware,

  async (req, res) => {
    const data = req.body;

    const {
      proposed_loan_amount,
      loan_type,
      loan_type_specific,
      calculatorLoanAmmount,
      calculatorInterestRate,
      calculatorMonthsToPay,

      work_name,
      has_business,
      type_of_business,

      disbursement_type, // The type of disbursement
      disbursement_bank_or_wallet_name, // The bank or e-wallet name
      disbursement_account_name, // The account holder's name
      disbursement_account_number, // The account number

      business_address,
      income_flow,
      income_amount,
      numberField,
      loan_security,
      relationship_to_loan_guarantor,
      loan_guarantor,
      employee_monthly_income_amount,
      employment_years
    } = data;

    let { user_id } = req.user;
    // console.log({ data });

    let borrower_id = await getBorrowerAccountByUserAccountId(user_id);
    // map to db
    let loan_application_id = uuidv4();
    let loan_amount_val = calculatorLoanAmmount || proposed_loan_amount;
    let repayment_schedule_id = calculatorMonthsToPay;
    let loan_type_value = loan_type || loan_type_specific;
    let interest_rate = calculatorInterestRate;
    let loan_status = 'Pending';
    let purpose = loan_type_specific;
    let remarks = '';

    try {
      await db.query(
        `INSERT INTO loan_application (application_id, borrower_id, loan_amount, status, qr_code_id)
       VALUES (?, ?, ?, ?, ?)`,
        [loan_application_id, borrower_id, loan_amount_val, loan_status, 1]
      );

      //  insert into loan table

      const [result] = await db.query(
        `INSERT INTO loan 
        (
       loan_application_id, 
       borrower_id, 
       loan_type_value,
       loan_amount, 
       interest_rate, 
       loan_status, 
       purpose, 
       remarks,
       repayment_schedule_id,
       employee_monthly_income_amount
       
       ) 
       VALUES ( ?, ?, ?, ?, ? ,?, ?,?, ?, ? )`,
        [
          loan_application_id,
          borrower_id,
          loan_type_value,
          loan_amount_val,
          interest_rate,
          loan_status,
          purpose,
          remarks,
          repayment_schedule_id,
          employee_monthly_income_amount || income_amount
        ]
      );

      const loanId = result.insertId;

      let mappedKey = {
        work_name: 'non_employee_work_name',
        has_business: 'non_employee_has_business',
        type_of_business: 'non_employee_type_of_business',
        disbursement_type: 'disbursement_type',
        disbursement_bank_or_wallet_name: 'disbursement_bank_or_wallet_name',
        disbursement_account_name: 'disbursement_account_name',
        disbursement_account_number: 'disbursement_account_number',
        business_address: 'non_employee_business_address',
        income_flow: 'non_employee_income_flow',
        income_amount: 'non_employee_income_amount',
        numberField: 'non_employee_numberField',
        loan_security: 'non_employee_loan_security',
        relationship_to_loan_guarantor:
          'non_employee_relationship_to_loan_guarantor',
        loan_guarantor: 'non_employee_loan_guarantor'
      };

      await db.query(
        `
        UPDATE borrower_account SET 
            employment_years = ?,
            monthly_income = ?

            where borrower_id  = ?
        `,
        [
          employment_years || 1,
          employee_monthly_income_amount || income_amount,
          borrower_id
        ]
      );

      await db.query(
        `
        UPDATE loan SET 
            ${mappedKey.work_name} = ?, 
            ${mappedKey.has_business} = ?, 
            ${mappedKey.type_of_business} = ?, 
            ${mappedKey.disbursement_type} = ?, 
            ${mappedKey.disbursement_bank_or_wallet_name} = ?, 
            ${mappedKey.disbursement_account_name} = ?, 
            ${mappedKey.disbursement_account_number} = ?, 
            ${mappedKey.business_address} = ?, 
            ${mappedKey.income_flow} = ?, 
            ${mappedKey.income_amount} = ?, 
            ${mappedKey.numberField} = ?, 
            ${mappedKey.loan_security} = ?, 
            ${mappedKey.relationship_to_loan_guarantor} = ?, 
            ${mappedKey.loan_guarantor} = ? 
        WHERE loan_id = ?
        `,
        [
          work_name,
          has_business,
          type_of_business,
          disbursement_type,
          disbursement_bank_or_wallet_name,
          disbursement_account_name,
          disbursement_account_number,
          business_address,
          income_flow,
          income_amount,
          numberField,
          loan_security,
          relationship_to_loan_guarantor,
          loan_guarantor,
          loanId // This is the last parameter
        ]
      );

      // insert QR CODE
      await db.query(`INSERT INTO qr_code ( code, type) VALUES ( ?, ?)`, [
        loan_application_id,
        'Loan Application'
      ]);

      const [rows1] = await db.query(
        `
        SELECT la.*, ba.* FROM loan la INNER 
        JOIN borrower_account ba ON la.borrower_id = 
        ba.borrower_id 
        where la.loan_id = ?
  
           `,
        [loanId]
      );

      let loanDetails = rows1[0];

      let { first_name, last_name, contact_number, loan_amount } = loanDetails;

      function formatPhoneNumber(phoneNumber) {
        // Remove any non-digit characters
        let cleaned = phoneNumber.replace(/\D/g, '');

        // Check if the number starts with '09' or any other prefix and always convert to '+63'
        if (cleaned.startsWith('9')) {
          cleaned = '+63' + cleaned.substring(1); // Replace '0' or '9' with '+63'
        } else if (cleaned.startsWith('0')) {
          cleaned = '+63' + cleaned.substring(1); // Replace '0' with '+63'
        }

        // Ensure the number has the correct length after conversion
        if (cleaned.length === 13) {
          return cleaned; // Return the correctly formatted number
        } else {
          return 'Invalid phone number length';
        }
      }

      // console.log(formatPhoneNumber(contact_number));
      await sendMessage({
        firstName: first_name,
        lastName: last_name,
        phoneNumber: formatPhoneNumber(contact_number),
        messageType: 'loanCreation',
        additionalData: { loanId: loanId, loanAmount: loan_amount }
      });

      res.status(201).json({
        success: true,
        message: 'Loan application created successfully',
        data: {
          loan_application_id
        }
      });
    } catch (err) {
      console.error(err); // Log the error for debugging
      res.status(500).json({
        success: false,
        message:
          'An error occurred while creating the loan application. Please try again later.'
      });
    }
  }
);

// Route to handle file uploads
router.post(
  '/payments/upload-files',
  upload.fields([{ name: 'proofOfPayment', maxCount: 1 }]),
  async (req, res) => {
    try {
      const files = req.files;
      const loan_id = req.body.loan_id;
      const selectedTableRowIndex = req.body.selectedTableRowIndex;

      for (const [key, fileArray] of Object.entries(files)) {
        const file = fileArray[0];
        const storageRef = ref(
          firebaseStorage,
          `lendease/loans/${loan_id}/payments/${selectedTableRowIndex}/${file.originalname}`
        );
        const metadata = { contentType: file.mimetype };

        await uploadBytes(storageRef, file.buffer, metadata);
        const downloadURL = await getDownloadURL(storageRef);

        await db.query(
          `UPDATE payment 
           SET proof_of_payment = ?
           WHERE loan_id = ? AND selectedTableRowIndex = ?`,
          [downloadURL, loan_id, selectedTableRowIndex]
        );
      }

      res.status(200).json({ message: 'Files uploaded successfully!' });
    } catch (error) {
      console.error('Error uploading files:', error);
      res.status(500).json({ error: 'Failed to upload files.' });
    }
  }
);

router.post('/list', authenticateUserMiddleware, async (req, res) => {
  let { user_id, role } = req.user;

  console.log({ role });

  try {
    let borrower_id = await getBorrowerAccountByUserAccountId(user_id);

    console.log({ borrower_id });
    const [rows] = await db.query(
      `


      SELECT la.*, ba.*, dd.* , la.loan_id as loan_id  FROM loan la INNER 
      JOIN borrower_account ba ON la.borrower_id = 
      ba.borrower_id 
      
      LEFT  JOIN disbursement_details dd ON la.loan_id = dd.loan_id
      

      ${role === 'Borrower' ? ' WHERE la.borrower_id  = ?' : ''}


      ORDER BY la.application_date DESC

         
         
         
         `,
      [borrower_id]
    );
    res.status(200).json({ success: true, data: rows });
    // if (rows.length > 0) {
    //   res.status(200).json({ success: true, data: rows });
    // } else {
    //   res.status(404).json({ message: 'No loans found for this user.' });
    // }
  } catch (error) {
    res
      .status(500)
      .json({ error: 'Error fetching loan list with borrower details' });
  }
});

router.get('/:loanId/details', authenticateUserMiddleware, async (req, res) => {
  try {
    let loanId = req.params.loanId;
    const [rows] = await db.query(
      `


      SELECT la.*, ba.* ,dd.* , la.loan_id as loan_id FROM loan la INNER 
      JOIN borrower_account ba ON la.borrower_id = 
      ba.borrower_id 
 
         LEFT  JOIN disbursement_details dd ON la.loan_id = dd.loan_id
         
     where la.loan_id = ?
       

         
         
         
         `,
      [loanId]
    );

    if (rows.length > 0) {
      res.status(200).json({ success: true, data: rows[0] });
    } else {
      res.status(404).json({ message: 'No loans found for this user.' });
    }
  } catch (error) {
    res
      .status(500)
      .json({ error: 'Error fetching loan list with borrower details' });
  }
});

// Create a new payment
router.post('/:loanId/payment', async (req, res) => {
  try {
    let loanId = req.params.loanId;

    const {
      loan_id,
      payment_amount,
      payment_date,
      payment_status,
      payment_method,
      reference_number,
      selectedTableRowIndex,
      includes_past_due,
      past_due_amount,
      original_amount
    } = req.body;

    // Insert payment with additional fields
    const [result] = await db.query(
      `INSERT INTO payment (
        loan_id, 
        payment_amount, 
        payment_date,
        payment_status, 
        payment_method, 
        reference_number,
        selectedTableRowIndex,
        includes_past_due,
        past_due_amount,
        original_amount,
        approval_or_rejected_date
      ) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        loan_id,
        payment_amount,
        payment_date,
        payment_status,
        payment_method,
        reference_number,
        selectedTableRowIndex,
        includes_past_due || false,
        past_due_amount || 0,
        original_amount || payment_amount
      ]
    );

    res.status(201).json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error creating payment' });
  }
});

// Get payment list with enhanced details
router.get('/:loanId/paymentList', async (req, res) => {
  try {
    const { loanId } = req.params;

    const [rows] = await db.query(
      `SELECT 
        p.*,
        CASE 
          WHEN p.payment_status = 'Approved' THEN true
          WHEN p.payment_status = 'Pending' THEN true
          ELSE false
        END as is_paid,
        CASE 
          WHEN p.includes_past_due = 1 THEN true
          ELSE false
        END as includes_past_due,
        COALESCE(p.original_amount, p.payment_amount) as original_amount,
        COALESCE(p.past_due_amount, 0) as past_due_amount,
        p.approval_or_rejected_date
      FROM payment p 
      WHERE p.loan_id = ?
      ORDER BY p.selectedTableRowIndex ASC`,
      [loanId]
    );

    res.status(200).json({ success: true, data: rows });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error fetching payment list' });
  }
});

// Update payment status route
router.post('/:loanId/updatePaymentStatus', async (req, res) => {
  try {
    const { loanId } = req.params;
    let { action, remarks, selectedTableRowIndex } = req.body;
    selectedTableRowIndex = 1;
    // Update payment status and approval/rejection date
    await db.query(
      `UPDATE payment 
       SET 
         payment_status = ?,
         approval_or_rejected_date = NOW(),
         loan_officer_id = ?,
         remarks = ?
       WHERE loan_id = ? AND selectedTableRowIndex = ?`,
      [action, req.user?.officer_id, remarks, loanId, selectedTableRowIndex]
    );

    // If payment is approved, handle past due updates
    if (action === 'Approved') {
      const [paymentRecord] = await db.query(
        `SELECT * FROM payment 
         WHERE loan_id = ? AND selectedTableRowIndex = ?`,
        [loanId, selectedTableRowIndex]
      );

      console.log({ paymentRecord, loanId, selectedTableRowIndex });
      if (paymentRecord[0]?.includes_past_due) {
        await db.query(
          `UPDATE payment 
           SET past_due_handled = true,
               past_due_handled_date = NOW()
           WHERE loan_id = ? AND selectedTableRowIndex = ?`,
          [loanId, selectedTableRowIndex]
        );
      }

      // Send notification to borrower
      const [loanDetails] = await db.query(
        `SELECT b.contact_number, b.first_name 
         FROM loan l 
         JOIN borrower_account b ON l.borrower_id = b.borrower_id 
         WHERE l.loan_id = ?`,
        [loanId]
      );

      if (loanDetails[0]) {
        await sendMessage({
          firstName: loanDetails[0].first_name,
          phoneNumber: loanDetails[0].contact_number,
          messageType: 'paymentApproved',
          additionalData: {
            paymentAmount: paymentRecord[0].payment_amount,
            referenceNumber: paymentRecord[0].reference_number
          }
        });
      }
    }

    res.status(200).json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error updating payment status' });
  }
});

// New endpoint to handle payment submission with file upload
router.post(
  '/:loanId/submit-payment',
  upload.single('proof_of_payment'),
  async (req, res) => {
    try {
      const { loanId } = req.params;
      const {
        payment_method,
        reference_number,
        amount,
        selectedTableRowIndex
      } = req.body;

      // Validate required fields
      if (!req.file || !payment_method || !reference_number || !amount) {
        return res.status(400).json({
          error: 'Missing required fields'
        });
      }

      // Upload file to Firebase Storage using the existing pattern
      const storageRef = ref(
        firebaseStorage,
        `lendease/loans/${loanId}/payments/${selectedTableRowIndex}/${req.file.originalname}`
      );

      const metadata = {
        contentType: req.file.mimetype
      };

      await uploadBytes(storageRef, req.file.buffer, metadata);
      const downloadURL = await getDownloadURL(storageRef);

      // Insert payment record
      await db.query(
        `INSERT INTO payment (
          loan_id, 
          payment_method, 
          reference_number, 
          payment_amount,
          proof_of_payment,
          payment_status,
          payment_date,
          selectedTableRowIndex
        ) VALUES (?, ?, ?, ?, ?, ?, NOW(), ?)`,
        [
          loanId,
          payment_method,
          reference_number,
          amount,
          downloadURL,
          'Pending',
          selectedTableRowIndex
        ]
      );

      res.status(200).json({
        success: true,
        message: 'Payment submitted successfully'
      });
    } catch (error) {
      console.error('Error submitting payment:', error);
      res.status(500).json({
        error: 'Error submitting payment'
      });
    }
  }
);

export default router;

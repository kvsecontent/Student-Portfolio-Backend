const express = require('express');
const cors = require('cors');
const axios = require('axios');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Only need these two environment variables
const GOOGLE_SHEETS_ID = process.env.GOOGLE_SHEETS_ID;
const GOOGLE_SHEETS_API_KEY = process.env.GOOGLE_SHEETS_API_KEY;

// Allow requests from GitHub Pages (or any origin for development)
app.use(cors({
  origin: '*',  // Allow all origins, or specify your GitHub Pages URL
  methods: ['GET'], // Only allow GET requests
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Simple API endpoint to fetch student data by admission number
app.get('/api/student-data', async (req, res) => {
  try {
    const admissionNumber = req.query.admission;
    
    // Validate admission number
    if (!admissionNumber || !/^\d{5}$/.test(admissionNumber)) {
      return res.status(400).json({ error: 'Invalid admission number. Must be 5 digits.' });
    }
    
    // Google Sheets API endpoint with multiple ranges
    const sheetsEndpoint = `https://sheets.googleapis.com/v4/spreadsheets/${GOOGLE_SHEETS_ID}/values:batchGet`;
    
    // Define the ranges we want to fetch
    const ranges = [
      'Students!A:G',
      'Subjects!A:D',
      'Activities!A:F',
      'Assignments!A:G',
      'Tests!A:H',
      'Corrections!A:F',
      'Attendance!A:F'
    ];
    
    // Build the full URL with query parameters
    const url = `${sheetsEndpoint}?key=${GOOGLE_SHEETS_API_KEY}&ranges=${ranges.map(range => encodeURIComponent(range)).join('&ranges=')}`;
    
    // Fetch data from Google Sheets
    const response = await axios.get(url);
    
    // Process the response to extract data for the specific student
    const processedData = processStudentData(response.data, admissionNumber);
    
    res.json(processedData);
  } catch (error) {
    console.error('Error fetching data from Google Sheets:', error);
    if (error.response && error.response.data) {
      console.error('Google API Error:', error.response.data);
    }
    res.status(500).json({ error: 'Failed to fetch data from Google Sheets' });
  }
});

// API status endpoint
app.get('/api/status', (req, res) => {
  res.json({ 
    status: 'online',
    message: 'Student Portfolio API is running',
    sheetsConfigured: Boolean(GOOGLE_SHEETS_ID && GOOGLE_SHEETS_API_KEY)
  });
});

// Process the Google Sheets response
function processStudentData(sheetsData, admissionNumber) {
  try {
    // Extract value ranges from the response
    const [studentsSheet, subjectsSheet, activitiesSheet, 
           assignmentsSheet, testsSheet, correctionsSheet, 
           attendanceSheet] = sheetsData.valueRanges;
    
    // Extract headers from each sheet
    const studentsHeaders = studentsSheet.values[0];
    const subjectsHeaders = subjectsSheet.values[0];
    const activitiesHeaders = activitiesSheet.values[0];
    const assignmentsHeaders = assignmentsSheet.values[0];
    const testsHeaders = testsSheet.values[0];
    const correctionsHeaders = correctionsSheet.values[0];
    const attendanceHeaders = attendanceSheet.values[0];
    
    // Find student info
    const studentData = findStudentByAdmissionNo(studentsSheet.values, studentsHeaders, admissionNumber);
    
    if (!studentData) {
      throw new Error(`Student with admission number ${admissionNumber} not found`);
    }
    
    // Extract student basic info
    const studentInfo = {
      name: getValueByHeader(studentData, studentsHeaders, 'name'),
      class: getValueByHeader(studentData, studentsHeaders, 'class'),
      admissionNo: getValueByHeader(studentData, studentsHeaders, 'admission_no'),
      rollNo: getValueByHeader(studentData, studentsHeaders, 'roll_no'),
      dob: getValueByHeader(studentData, studentsHeaders, 'dob'),
      contact: getValueByHeader(studentData, studentsHeaders, 'contact'),
      photoUrl: getValueByHeader(studentData, studentsHeaders, 'photo_url') || '/api/placeholder/120/120'
    };
    
    // Extract subject progress
    const subjectProgress = filterSheetByAdmissionNo(subjectsSheet.values, subjectsHeaders, admissionNumber)
      .map(row => ({
        subject: getValueByHeader(row, subjectsHeaders, 'subject'),
        progress: parseFloat(getValueByHeader(row, subjectsHeaders, 'progress')),
        grade: getValueByHeader(row, subjectsHeaders, 'grade')
      }));
    
    // Extract recent tests (last 5)
    const recentTests = filterSheetByAdmissionNo(testsSheet.values, testsHeaders, admissionNumber)
      .sort((a, b) => {
        const dateA = new Date(getValueByHeader(a, testsHeaders, 'date').split('-').reverse().join('-'));
        const dateB = new Date(getValueByHeader(b, testsHeaders, 'date').split('-').reverse().join('-'));
        return dateB - dateA;
      })
      .slice(0, 5)
      .map(row => ({
        subject: getValueByHeader(row, testsHeaders, 'subject'),
        name: getValueByHeader(row, testsHeaders, 'name'),
        date: getValueByHeader(row, testsHeaders, 'date'),
        marks: `${getValueByHeader(row, testsHeaders, 'marks_obtained')}/${getValueByHeader(row, testsHeaders, 'max_marks')}`,
        percentage: parseFloat(getValueByHeader(row, testsHeaders, 'percentage')),
        grade: getValueByHeader(row, testsHeaders, 'grade')
      }));
    
    // Extract subject activities
    const subjectActivities = filterSheetByAdmissionNo(activitiesSheet.values, activitiesHeaders, admissionNumber)
      .map(row => ({
        subject: getValueByHeader(row, activitiesHeaders, 'subject'),
        activity: getValueByHeader(row, activitiesHeaders, 'activity'),
        date: getValueByHeader(row, activitiesHeaders, 'date'),
        description: getValueByHeader(row, activitiesHeaders, 'description'),
        status: getValueByHeader(row, activitiesHeaders, 'status')
      }));
    
    // Extract assignments
    const assignments = filterSheetByAdmissionNo(assignmentsSheet.values, assignmentsHeaders, admissionNumber)
      .map(row => ({
        subject: getValueByHeader(row, assignmentsHeaders, 'subject'),
        name: getValueByHeader(row, assignmentsHeaders, 'name'),
        assignedDate: getValueByHeader(row, assignmentsHeaders, 'assigned_date'),
        dueDate: getValueByHeader(row, assignmentsHeaders, 'due_date'),
        status: getValueByHeader(row, assignmentsHeaders, 'status'),
        remarks: getValueByHeader(row, assignmentsHeaders, 'remarks') || ''
      }));
    
    // Extract tests
    const tests = filterSheetByAdmissionNo(testsSheet.values, testsHeaders, admissionNumber)
      .map(row => ({
        subject: getValueByHeader(row, testsHeaders, 'subject'),
        name: getValueByHeader(row, testsHeaders, 'name'),
        date: getValueByHeader(row, testsHeaders, 'date'),
        maxMarks: parseInt(getValueByHeader(row, testsHeaders, 'max_marks')),
        marksObtained: parseInt(getValueByHeader(row, testsHeaders, 'marks_obtained')),
        percentage: parseFloat(getValueByHeader(row, testsHeaders, 'percentage')),
        grade: getValueByHeader(row, testsHeaders, 'grade')
      }));
    
    // Extract copy corrections
    const corrections = filterSheetByAdmissionNo(correctionsSheet.values, correctionsHeaders, admissionNumber)
      .map(row => ({
        subject: getValueByHeader(row, correctionsHeaders, 'subject'),
        copyType: getValueByHeader(row, correctionsHeaders, 'copy_type'),
        date: getValueByHeader(row, correctionsHeaders, 'date'),
        improvements: getValueByHeader(row, correctionsHeaders, 'improvements'),
        remarks: getValueByHeader(row, correctionsHeaders, 'remarks')
      }));
    
    // Extract attendance
    const attendance = filterSheetByAdmissionNo(attendanceSheet.values, attendanceHeaders, admissionNumber)
      .map(row => ({
        month: getValueByHeader(row, attendanceHeaders, 'month'),
        workingDays: parseInt(getValueByHeader(row, attendanceHeaders, 'working_days')),
        present: parseInt(getValueByHeader(row, attendanceHeaders, 'present')),
        absent: parseInt(getValueByHeader(row, attendanceHeaders, 'absent')),
        percentage: parseFloat(getValueByHeader(row, attendanceHeaders, 'percentage'))
      }));
    
    // Calculate summary statistics
    const completedAssignments = assignments.filter(a => a.status === 'complete').length;
    const pendingAssignments = assignments.filter(a => a.status === 'pending').length;
    const overallAttendance = attendance.length > 0 
      ? attendance.reduce((sum, month) => sum + month.percentage, 0) / attendance.length
      : 0;
    
    // Compile all data
    return {
      studentInfo,
      subjectProgress,
      recentTests,
      subjectActivities,
      assignments,
      tests,
      corrections,
      attendance,
      summary: {
        totalSubjects: subjectProgress.length,
        completedAssignments,
        pendingAssignments,
        attendancePercentage: `${overallAttendance.toFixed(1)}%`
      }
    };
  } catch (error) {
    console.error('Error processing student data:', error);
    throw error;
  }
}

// Helper function to find a student by admission number
function findStudentByAdmissionNo(values, headers, admissionNo) {
  const admissionIndex = headers.findIndex(h => h.toLowerCase() === 'admission_no');
  if (admissionIndex === -1) return null;
  
  // Skip header row (index 0) and find student
  for (let i = 1; i < values.length; i++) {
    if (values[i][admissionIndex] === admissionNo) {
      return values[i];
    }
  }
  
  return null;
}

// Helper function to filter sheet data by admission number
function filterSheetByAdmissionNo(values, headers, admissionNo) {
  const admissionIndex = headers.findIndex(h => h.toLowerCase() === 'admission_no');
  if (admissionIndex === -1) return [];
  
  // Skip header row (index 0) and filter rows
  return values.slice(1).filter(row => row[admissionIndex] === admissionNo);
}

// Helper function to get a value by header name
function getValueByHeader(row, headers, headerName) {
  const index = headers.findIndex(h => h.toLowerCase() === headerName.toLowerCase());
  return index !== -1 ? (row[index] || '') : '';
}

// Start the server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Google Sheets ID configured: ${Boolean(GOOGLE_SHEETS_ID)}`);
  console.log(`Google Sheets API Key configured: ${Boolean(GOOGLE_SHEETS_API_KEY)}`);
});

module.exports = app;

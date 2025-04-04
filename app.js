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
    
    // Define the ranges we want to fetch - Using wider ranges for horizontal data
    const ranges = [
      'Students!A:G',
      'Subjects!A:ZZ',      // Wider range for horizontal subject data
      'Activities!A:ZZZ',    // Wider range for horizontal activities
      'Assignments!A:ZZZ',   // Wider range for horizontal assignments
      'Tests!A:ZZZ',         // Wider range for horizontal tests
      'Corrections!A:ZZZ',   // Wider range for horizontal corrections
      'Attendance!A:ZZZ'     // Wider range for horizontal attendance
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

// Process the Google Sheets response with HORIZONTAL data structure
function processStudentData(sheetsData, admissionNumber) {
  try {
    // Extract value ranges from the response
    const [studentsSheet, subjectsSheet, activitiesSheet, 
           assignmentsSheet, testsSheet, correctionsSheet, 
           attendanceSheet] = sheetsData.valueRanges;
    
    // Extract headers from each sheet
    const studentsHeaders = studentsSheet.values[0] || [];
    const subjectsHeaders = subjectsSheet.values[0] || [];
    const activitiesHeaders = activitiesSheet.values[0] || [];
    const assignmentsHeaders = assignmentsSheet.values[0] || [];
    const testsHeaders = testsSheet.values[0] || [];
    const correctionsHeaders = correctionsSheet.values[0] || [];
    const attendanceHeaders = attendanceSheet.values[0] || [];
    
    // Find student info row - this remains the same (vertical format)
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
    
    // Find student rows for each horizontal sheet
    const subjectRow = findStudentByAdmissionNo(subjectsSheet.values, subjectsHeaders, admissionNumber);
    const activitiesRow = findStudentByAdmissionNo(activitiesSheet.values, activitiesHeaders, admissionNumber);
    const assignmentsRow = findStudentByAdmissionNo(assignmentsSheet.values, assignmentsHeaders, admissionNumber);
    const testsRow = findStudentByAdmissionNo(testsSheet.values, testsHeaders, admissionNumber);
    const correctionsRow = findStudentByAdmissionNo(correctionsSheet.values, correctionsHeaders, admissionNumber);
    const attendanceRow = findStudentByAdmissionNo(attendanceSheet.values, attendanceHeaders, admissionNumber);
    
    // Process horizontal data for each section
    const subjectProgress = processHorizontalSubjects(subjectsHeaders, subjectRow);
    const subjectActivities = processHorizontalActivities(activitiesHeaders, activitiesRow);
    const assignments = processHorizontalAssignments(assignmentsHeaders, assignmentsRow);
    const tests = processHorizontalTests(testsHeaders, testsRow);
    
    // Sort tests by date (newest first) and take the 5 most recent for dashboard
    const recentTests = [...tests].sort((a, b) => {
      // Handle date format: dd-mm-yyyy
      const partsA = a.date.split('-');
      const partsB = b.date.split('-');
      const dateA = new Date(partsA[2], partsA[1] - 1, partsA[0]);
      const dateB = new Date(partsB[2], partsB[1] - 1, partsB[0]);
      return dateB - dateA;
    }).slice(0, 5).map(test => ({
      subject: test.subject,
      name: test.name,
      date: test.date,
      marks: `${test.marksObtained}/${test.maxMarks}`,
      percentage: test.percentage,
      grade: test.grade
    }));
    
    const corrections = processHorizontalCorrections(correctionsHeaders, correctionsRow);
    const attendance = processHorizontalAttendance(attendanceHeaders, attendanceRow);
    
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

// Process horizontally structured subjects data
function processHorizontalSubjects(headers, studentRow) {
  if (!studentRow || !headers) return [];
  
  const subjects = [];
  const progressSuffix = '_progress';
  const gradeSuffix = '_grade';
  
  for (let i = 0; i < headers.length; i++) {
    const header = headers[i].toLowerCase();
    
    if (header.endsWith(progressSuffix)) {
      const subject = header.substring(0, header.length - progressSuffix.length);
      
      // Get the progress value
      const progressValue = studentRow[i];
      if (!progressValue) continue; // Skip if no progress value
      
      const progress = parseFloat(progressValue);
      if (isNaN(progress)) continue; // Skip if progress is not a number
      
      // Find the matching grade column
      const gradeHeader = `${subject}${gradeSuffix}`;
      const gradeIndex = headers.findIndex(h => h.toLowerCase() === gradeHeader);
      const grade = (gradeIndex !== -1 && studentRow[gradeIndex]) ? studentRow[gradeIndex] : '';
      
      // Only add subjects with valid progress values
      subjects.push({
        subject: capitalizeSubject(subject),
        progress: progress,
        grade: grade
      });
    }
  }
  
  return subjects;
}

// Process horizontally structured activities data
function processHorizontalActivities(headers, studentRow) {
  if (!studentRow || !headers) return [];
  
  const activities = [];
  
  // Key format examples: math_activity1, math_activity1_date, math_activity1_description, etc.
  const activityPattern = /^([a-z_]+)_activity(\d+)$/;
  
  for (let i = 0; i < headers.length; i++) {
    const header = headers[i].toLowerCase();
    const match = header.match(activityPattern);
    
    if (match && studentRow[i]) {
      const subject = match[1]; // e.g., "math"
      const activityNum = match[2]; // e.g., "1"
      const activityName = studentRow[i];
      
      // Skip if no activity name
      if (!activityName) continue;
      
      // Find related fields
      const dateHeader = `${subject}_activity${activityNum}_date`;
      const descHeader = `${subject}_activity${activityNum}_description`;
      const statusHeader = `${subject}_activity${activityNum}_status`;
      
      const dateIndex = headers.findIndex(h => h.toLowerCase() === dateHeader);
      const descIndex = headers.findIndex(h => h.toLowerCase() === descHeader);
      const statusIndex = headers.findIndex(h => h.toLowerCase() === statusHeader);
      
      const date = dateIndex !== -1 ? (studentRow[dateIndex] || '') : '';
      const description = descIndex !== -1 ? (studentRow[descIndex] || '') : '';
      const status = statusIndex !== -1 ? (studentRow[statusIndex] || 'pending') : 'pending';
      
      activities.push({
        subject: capitalizeSubject(subject),
        activity: activityName,
        date: date,
        description: description,
        status: status.toLowerCase()
      });
    }
  }
  
  return activities;
}

// Process horizontally structured assignments data
function processHorizontalAssignments(headers, studentRow) {
  if (!studentRow || !headers) return [];
  
  const assignments = [];
  
  // Key format examples: math_assignment1, math_assignment1_assigned_date, etc.
  const assignmentPattern = /^([a-z_]+)_assignment(\d+)$/;
  
  for (let i = 0; i < headers.length; i++) {
    const header = headers[i].toLowerCase();
    const match = header.match(assignmentPattern);
    
    if (match && studentRow[i]) {
      const subject = match[1]; // e.g., "math"
      const assignmentNum = match[2]; // e.g., "1"
      const assignmentName = studentRow[i];
      
      // Skip if no assignment name
      if (!assignmentName) continue;
      
      // Find related fields
      const assignedDateHeader = `${subject}_assignment${assignmentNum}_assigned_date`;
      const dueDateHeader = `${subject}_assignment${assignmentNum}_due_date`;
      const statusHeader = `${subject}_assignment${assignmentNum}_status`;
      const remarksHeader = `${subject}_assignment${assignmentNum}_remarks`;
      
      const assignedDateIndex = headers.findIndex(h => h.toLowerCase() === assignedDateHeader);
      const dueDateIndex = headers.findIndex(h => h.toLowerCase() === dueDateHeader);
      const statusIndex = headers.findIndex(h => h.toLowerCase() === statusHeader);
      const remarksIndex = headers.findIndex(h => h.toLowerCase() === remarksHeader);
      
      const assignedDate = assignedDateIndex !== -1 ? (studentRow[assignedDateIndex] || '') : '';
      const dueDate = dueDateIndex !== -1 ? (studentRow[dueDateIndex] || '') : '';
      const status = statusIndex !== -1 ? (studentRow[statusIndex] || 'pending') : 'pending';
      const remarks = remarksIndex !== -1 ? (studentRow[remarksIndex] || '') : '';
      
      assignments.push({
        subject: capitalizeSubject(subject),
        name: assignmentName,
        assignedDate: assignedDate,
        dueDate: dueDate,
        status: status.toLowerCase(),
        remarks: remarks
      });
    }
  }
  
  return assignments;
}

// Process horizontally structured tests data
function processHorizontalTests(headers, studentRow) {
  if (!studentRow || !headers) return [];
  
  const tests = [];
  
  // Key format examples: math_test1, math_test1_date, math_test1_max_marks, etc.
  const testPattern = /^([a-z_]+)_test(\d+)$/;
  
  for (let i = 0; i < headers.length; i++) {
    const header = headers[i].toLowerCase();
    const match = header.match(testPattern);
    
    if (match && studentRow[i]) {
      const subject = match[1]; // e.g., "math"
      const testNum = match[2]; // e.g., "1"
      const testName = studentRow[i];
      
      // Skip if no test name
      if (!testName) continue;
      
      // Find related fields
      const dateHeader = `${subject}_test${testNum}_date`;
      const maxMarksHeader = `${subject}_test${testNum}_max_marks`;
      const marksObtainedHeader = `${subject}_test${testNum}_marks_obtained`;
      const percentageHeader = `${subject}_test${testNum}_percentage`;
      const gradeHeader = `${subject}_test${testNum}_grade`;
      
      const dateIndex = headers.findIndex(h => h.toLowerCase() === dateHeader);
      const maxMarksIndex = headers.findIndex(h => h.toLowerCase() === maxMarksHeader);
      const marksObtainedIndex = headers.findIndex(h => h.toLowerCase() === marksObtainedHeader);
      const percentageIndex = headers.findIndex(h => h.toLowerCase() === percentageHeader);
      const gradeIndex = headers.findIndex(h => h.toLowerCase() === gradeHeader);
      
      const date = dateIndex !== -1 ? (studentRow[dateIndex] || '') : '';
      
      // Parse numeric values safely
      let maxMarks = 0;
      if (maxMarksIndex !== -1 && studentRow[maxMarksIndex]) {
        maxMarks = parseInt(studentRow[maxMarksIndex]);
        if (isNaN(maxMarks)) maxMarks = 0;
      }
      
      let marksObtained = 0;
      if (marksObtainedIndex !== -1 && studentRow[marksObtainedIndex]) {
        marksObtained = parseInt(studentRow[marksObtainedIndex]);
        if (isNaN(marksObtained)) marksObtained = 0;
      }
      
      let percentage = 0;
      if (percentageIndex !== -1 && studentRow[percentageIndex]) {
        percentage = parseFloat(studentRow[percentageIndex]);
        if (isNaN(percentage)) {
          // Calculate percentage if not provided but we have maxMarks and marksObtained
          if (maxMarks > 0) {
            percentage = (marksObtained / maxMarks) * 100;
          }
        }
      } else if (maxMarks > 0) {
        // Calculate percentage if not provided
        percentage = (marksObtained / maxMarks) * 100;
      }
      
      const grade = gradeIndex !== -1 ? (studentRow[gradeIndex] || '') : '';
      
      tests.push({
        subject: capitalizeSubject(subject),
        name: testName,
        date: date,
        maxMarks: maxMarks,
        marksObtained: marksObtained,
        percentage: percentage,
        grade: grade
      });
    }
  }
  
  return tests;
}

// Process horizontally structured corrections data
function processHorizontalCorrections(headers, studentRow) {
  if (!studentRow || !headers) return [];
  
  const corrections = [];
  
  // Key format examples: math_correction1, math_correction1_date, etc.
  const correctionPattern = /^([a-z_]+)_correction(\d+)$/;
  
  for (let i = 0; i < headers.length; i++) {
    const header = headers[i].toLowerCase();
    const match = header.match(correctionPattern);
    
    if (match && studentRow[i]) {
      const subject = match[1]; // e.g., "math"
      const correctionNum = match[2]; // e.g., "1"
      const copyType = studentRow[i];
      
      // Skip if no copy type
      if (!copyType) continue;
      
      // Find related fields
      const dateHeader = `${subject}_correction${correctionNum}_date`;
      const improvementsHeader = `${subject}_correction${correctionNum}_improvements`;
      const remarksHeader = `${subject}_correction${correctionNum}_remarks`;
      
      const dateIndex = headers.findIndex(h => h.toLowerCase() === dateHeader);
      const improvementsIndex = headers.findIndex(h => h.toLowerCase() === improvementsHeader);
      const remarksIndex = headers.findIndex(h => h.toLowerCase() === remarksHeader);
      
      const date = dateIndex !== -1 ? (studentRow[dateIndex] || '') : '';
      const improvements = improvementsIndex !== -1 ? (studentRow[improvementsIndex] || '') : '';
      const remarks = remarksIndex !== -1 ? (studentRow[remarksIndex] || '') : '';
      
      corrections.push({
        subject: capitalizeSubject(subject),
        copyType: copyType,
        date: date,
        improvements: improvements,
        remarks: remarks
      });
    }
  }
  
  return corrections;
}

// Process horizontally structured attendance data
function processHorizontalAttendance(headers, studentRow) {
  if (!studentRow || !headers) return [];
  
  const attendance = [];
  
  // Key format examples: april_working, april_present, april_absent, april_percent
  const workingSuffix = '_working';
  
  for (let i = 0; i < headers.length; i++) {
    const header = headers[i].toLowerCase();
    
    if (header.endsWith(workingSuffix) && studentRow[i]) {
      const month = header.substring(0, header.length - workingSuffix.length);
      
      // Parse working days safely
      let workingDays = 0;
      if (studentRow[i]) {
        workingDays = parseInt(studentRow[i]);
        if (isNaN(workingDays)) workingDays = 0;
      }
      
      // Skip if no working days
      if (workingDays <= 0) continue;
      
      // Find related fields
      const presentHeader = `${month}_present`;
      const absentHeader = `${month}_absent`;
      const percentHeader = `${month}_percent`;
      
      const presentIndex = headers.findIndex(h => h.toLowerCase() === presentHeader);
      const absentIndex = headers.findIndex(h => h.toLowerCase() === absentHeader);
      const percentIndex = headers.findIndex(h => h.toLowerCase() === percentHeader);
      
      // Parse present days safely
      let present = 0;
      if (presentIndex !== -1 && studentRow[presentIndex]) {
        present = parseInt(studentRow[presentIndex]);
        if (isNaN(present)) present = 0;
      }
      
      // Parse absent days safely
      let absent = 0;
      if (absentIndex !== -1 && studentRow[absentIndex]) {
        absent = parseInt(studentRow[absentIndex]);
        if (isNaN(absent)) absent = 0;
      }
      
      // Parse or calculate percentage
      let percentage = 0;
      if (percentIndex !== -1 && studentRow[percentIndex]) {
        percentage = parseFloat(studentRow[percentIndex]);
        if (isNaN(percentage)) {
          // Calculate if parsing failed
          if (workingDays > 0) {
            percentage = (present / workingDays) * 100;
          }
        }
      } else if (workingDays > 0) {
        // Calculate if not provided
        percentage = (present / workingDays) * 100;
      }
      
      attendance.push({
        month: capitalizeFirstLetter(month),
        workingDays: workingDays,
        present: present,
        absent: absent,
        percentage: percentage
      });
    }
  }
  
  return attendance;
}

// Helper function to find a student by admission number
function findStudentByAdmissionNo(values, headers, admissionNo) {
  if (!values || !headers || values.length < 2) return null;
  
  const admissionIndex = headers.findIndex(h => h.toLowerCase() === 'admission_no');
  if (admissionIndex === -1) return null;
  
  // Skip header row (index 0) and find student
  for (let i = 1; i < values.length; i++) {
    if (values[i] && values[i][admissionIndex] === admissionNo) {
      return values[i];
    }
  }
  
  return null;
}

// Helper function to get a value by header name
function getValueByHeader(row, headers, headerName) {
  if (!row || !headers) return '';
  
  const index = headers.findIndex(h => h.toLowerCase() === headerName.toLowerCase());
  return index !== -1 && index < row.length ? (row[index] || '') : '';
}

// Helper function to capitalize first letter
function capitalizeFirstLetter(string) {
  if (!string) return '';
  return string.charAt(0).toUpperCase() + string.slice(1);
}

// Helper function to capitalize subject names (handles multi-word subjects)
function capitalizeSubject(subject) {
  if (!subject) return '';
  return subject.split('_')
    .map(word => capitalizeFirstLetter(word))
    .join(' ');
}

// Start the server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Google Sheets ID configured: ${Boolean(GOOGLE_SHEETS_ID)}`);
  console.log(`Google Sheets API Key configured: ${Boolean(GOOGLE_SHEETS_API_KEY)}`);
});

module.exports = app;

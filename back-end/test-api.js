const axios = require('axios');

const BASE_URL = 'http://localhost:5000/api';

const testConfig = {
  timeout: 5000,
  headers: {
    'Content-Type': 'application/json'
  }
};

const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  reset: '\x1b[0m'
};

let passedTests = 0;
let failedTests = 0;

const logTest = (testName, success, message = '') => {
  if (success) {
    console.log(`${colors.green}PASS${colors.reset}: ${testName}`);
    passedTests++;
  } else {
    console.log(`${colors.red} FAIL${colors.reset}: ${testName} - ${message}`);
    failedTests++;
  }
};

const makeRequest = async (method, endpoint, data = null) => {
  try {
    const config = { ...testConfig };
    if (data) {
      config.data = data;
    }
    const response = await axios[method](`${BASE_URL}${endpoint}`, config);
    return { success: true, data: response.data, status: response.status };
  } catch (error) {
    return { 
      success: false, 
      error: error.response?.data || error.message, 
      status: error.response?.status 
    };
  }
};

const testHealthCheck = async () => {
  console.log('\n🔍 Testing Health Check...');
  const result = await makeRequest('get', '/health');
  logTest('Health Check', result.success && result.data.status === 'OK');
  if (result.success) {
    console.log(`   Status: ${result.data.status}`);
    console.log(`   Message: ${result.data.message}`);
  }
};

const testDoctorsAPI = async () => {
  console.log('\n👨‍⚕️ Testing Doctors API...');
  
  const getAllDoctors = await makeRequest('get', '/doctors');
  logTest('Get All Doctors', getAllDoctors.success && Array.isArray(getAllDoctors.data));
  
  if (getAllDoctors.success) {
    console.log(`   Found ${getAllDoctors.data.length} doctors`);
    getAllDoctors.data.forEach(doctor => {
      console.log(`   - Dr. ${doctor.name} (${doctor.specialization})`);
    });
  }
  
  if (getAllDoctors.success && getAllDoctors.data.length > 0) {
    const doctorId = getAllDoctors.data[0].id;
    const getDoctor = await makeRequest('get', `/doctors/${doctorId}`);
    logTest('Get Specific Doctor', getDoctor.success && getDoctor.data.id === doctorId);
  }
};

const testPatientsAPI = async () => {
  console.log('\n👥 Testing Patients API...');
  
  const getAllPatients = await makeRequest('get', '/patients');
  logTest('Get All Patients', getAllPatients.success && Array.isArray(getAllPatients.data));
  
  if (getAllPatients.success) {
    console.log(`   Found ${getAllPatients.data.length} patients`);
    getAllPatients.data.forEach(patient => {
      console.log(`   - ${patient.name} (${patient.email})`);
    });
  }
  
  if (getAllPatients.success && getAllPatients.data.length > 0) {
    const patientId = getAllPatients.data[0].id;
    const getPatient = await makeRequest('get', `/patients/${patientId}`);
    logTest('Get Specific Patient', getPatient.success && getPatient.data.id === patientId);
  }
};

const testAppointmentsAPI = async () => {
  console.log('\n📅 Testing Appointments API...');
  
  const getAllAppointments = await makeRequest('get', '/appointments');
  logTest('Get All Appointments', getAllAppointments.success && Array.isArray(getAllAppointments.data));
  
  if (getAllAppointments.success) {
    console.log(`   Found ${getAllAppointments.data.length} appointments`);
    
    const statusCount = {};
    getAllAppointments.data.forEach(apt => {
      statusCount[apt.status] = (statusCount[apt.status] || 0) + 1;
    });
    
    Object.entries(statusCount).forEach(([status, count]) => {
      console.log(`   - ${status}: ${count}`);
    });
  }
  
  const getDoctors = await makeRequest('get', '/doctors');
  if (getDoctors.success && getDoctors.data.length > 0) {
    const doctorId = getDoctors.data[0].id;
    const getByDoctor = await makeRequest('get', `/appointments?doctorId=${doctorId}`);
    logTest('Get Appointments by Doctor', getByDoctor.success);
  }
  
  const getPatients = await makeRequest('get', '/patients');
  if (getPatients.success && getPatients.data.length > 0) {
    const patientId = getPatients.data[0].id;
    const getByPatient = await makeRequest('get', `/appointments?patientId=${patientId}`);
    logTest('Get Appointments by Patient', getByPatient.success);
  }
};

const testAppointmentBooking = async () => {
  console.log('\n📝 Testing Appointment Booking...');
  
  const [doctors, patients] = await Promise.all([
    makeRequest('get', '/doctors'),
    makeRequest('get', '/patients')
  ]);
  
  if (!doctors.success || !patients.success) {
    logTest('Appointment Booking Setup', false, 'Could not fetch doctors or patients');
    return;
  }
  
  const appointments = await makeRequest('get', '/appointments');
  if (!appointments.success) {
    logTest('Appointment Booking', false, 'Could not fetch appointments');
    return;
  }
  
  const availableSlot = appointments.data.find(apt => apt.status === 'available');
  if (!availableSlot) {
    logTest('Appointment Booking', false, 'No available slots found');
    return;
  }
  
  const bookingData = {
    patientId: patients.data[0].id,
    doctorId: availableSlot.doctorId,
    date: availableSlot.date,
    time: availableSlot.time,
    notes: 'Test appointment booking'
  };
  
  const bookAppointment = await makeRequest('post', '/appointments', bookingData);
  logTest('Book Appointment', bookAppointment.success);
  
  if (bookAppointment.success) {
    console.log(`   Booked appointment: ${bookingData.date} at ${bookingData.time}`);
  }
};

const testErrorHandling = async () => {
  console.log('\n Testing Error Handling...');
  
  const invalidAppointment = await makeRequest('get', '/appointments/invalid-id');
  logTest('Invalid Appointment ID', !invalidAppointment.success && invalidAppointment.status === 404);
  
  const invalidDoctor = await makeRequest('get', '/doctors/invalid-id');
  logTest('Invalid Doctor ID', !invalidDoctor.success && invalidDoctor.status === 404);
  
  const invalidPatient = await makeRequest('get', '/patients/invalid-id');
  logTest('Invalid Patient ID', !invalidPatient.success && invalidPatient.status === 404);
};

const runAllTests = async () => {
  console.log(`${colors.blue}🚀 Starting Backend API Tests${colors.reset}`);
  console.log(`Base URL: ${BASE_URL}`);
  console.log(`Timestamp: ${new Date().toISOString()}`);
  
  try {
    await testHealthCheck();
    await testDoctorsAPI();
    await testPatientsAPI();
    await testAppointmentsAPI();
    await testAppointmentBooking();
    await testErrorHandling();
  
    
    if (failedTests === 0) {
      console.log(`\n${colors.green} All tests passed! Backend is working correctly.${colors.reset}`);
    } else {
      console.log(`\n${colors.red} Some tests failed. Please check the errors above.${colors.reset}`);
    }
    
  } catch (error) {
    console.error(`${colors.red} Test runner error:${colors.reset}`, error.message);
  }
};

if (require.main === module) {
  runAllTests();
}

module.exports = { runAllTests };

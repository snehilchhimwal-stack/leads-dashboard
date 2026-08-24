/**
 * RM Hierarchy — resolves each RM's real manager chain (Team Lead / RH / CH,
 * or an Admin/S2 escalation contact where that's what the org chart actually
 * says) from a one-time export of the "TL & RM by Region" sheet, so
 * OvernightEmailer.gs can route an issue email to the SPECIFIC managers of
 * whichever RMs actually had overnight activity — not a single fixed
 * per-region address that gets CC'd on everything whether or not anyone
 * under them did anything.
 *
 * WHY THIS IS ITS OWN FILE: RM_HIERARCHY_RAW_ below is a large static table
 * (one row per person from the source export) — keeping it separate from
 * OvernightEmailer.gs's send logic makes both easier to read, and makes it
 * obvious this table is data to refresh occasionally, not code to edit.
 *
 * THE REAL ORG CHART IS NOT A CLEAN 4-LEVEL LADDER. Only RM and Team Lead
 * rows have their own line in the source export — RH/CH/Admin/S2 people
 * never do, they only ever appear as someone else's "Reports To". Most RMs
 * report to a Team Lead (tagged "A1"), whose own row then shows an RH or CH
 * above them — a real 2-hop chain. But plenty of RMs skip that and report
 * STRAIGHT to an RH or CH with no Team Lead in between, a few report to
 * "Admin" or "S2" instead (doesn't fit the TL/RH/CH pattern at all), and a
 * meaningful number have no manager on file at all ("-"). This file resolves
 * whichever shape actually applies to each specific person — it does not
 * force everyone through the same number of hops.
 *
 * EMAIL ADDRESSES: the org-chart export above has no email column, but
 * EMPLOYEE_EMAIL_BY_NAME_RAW_ below does — a separate one-time export of
 * the full company HR roster (Book7.xlsx, "New E Code"/Name/Role/.../
 * "Official Mail Id"/...), matched in by NAME (case/whitespace-normalized,
 * see normPersonName_) since the two source files share no common ID.
 * setupRmHierarchy() writes a "Manager_Directory" sheet — one row per
 * unique manager name — with its Email column PRE-FILLED wherever a name
 * match was found; still blank for the handful that weren't (mostly the
 * same people RM_Hierarchy's Note column already flags as unresolved
 * managers). A human can always overwrite any auto-filled email — see
 * point 3 below for what survives a later rebuild. Until a manager has an
 * email (auto-filled or hand-entered), resolveRecipientsForRegion_ in
 * OvernightEmailer.gs finds no emails to route to for RMs under them and
 * falls back to the legacy Region_Recipients entry for that region, so
 * today's automation keeps working unchanged for anyone still uncovered.
 *
 * ============================== SETUP (one-time) ==============================
 *   1. Same Apps Script project as MovementTracker.gs and OvernightEmailer.gs.
 *      Add a new file, paste this whole thing in.
 *   2. Run setupRmHierarchy once (or it runs automatically as part of
 *      setupOvernightEmailer). This creates two sheets:
 *        - RM_Hierarchy: one row per person, showing the raw "Reports To"
 *          from the source export AND the resolved TL/RH/CH/Other columns.
 *          An "Excluded" checkbox is pre-ticked for rows this script
 *          recognised as a dummy/test/placeholder account (name patterns
 *          like "Dummy", "Test", "S 1 Account", a person reporting to
 *          themselves, or the whole "Wakanda" sandbox region) — un-tick any
 *          it got wrong. A "Note" column flags the ~5 people whose manager
 *          name never appears as its own Team Lead row in the source file,
 *          so RH/CH couldn't be resolved for them automatically — fill
 *          those in by hand if you want that chain covered.
 *        - Manager_Directory: one row per unique manager name (deduped
 *          across every TL/RH/CH/Other they show up as) with the regions
 *          they cover and a blank Email column. Fill in emails here, not
 *          in RM_Hierarchy — one entry covers everyone who reports to them.
 *   3. Re-running setupRmHierarchy (or the standalone rebuildRmHierarchy)
 *      later — e.g. after a fresh export — refreshes both sheets from the
 *      embedded table but PRESERVES every email already sitting in
 *      Manager_Directory, auto-filled or hand-typed alike (matched by
 *      manager name) — a rebuild never overwrites an email that's already
 *      there, only adds one where the cell was blank. Manual Excluded/Note
 *      edits in RM_Hierarchy are preserved the same way (matched by person
 *      name).
 * ================================================================================
 */

const RM_HIERARCHY_SHEET_ = 'RM_Hierarchy';
const MANAGER_DIRECTORY_SHEET_ = 'Manager_Directory';

// One row per person: [region, role, name, reportsTo, reportsToRole].
// Source: TL_RM_Region_wise_1.xlsx ("TL & RM by Region" tab), exported
// 2026-08. Role is only ever 'RM' or 'Team Lead' — RH/CH/Admin/S2 people
// never get their own row, only ever appear as a reportsTo value.
const RM_HIERARCHY_RAW_ = [
  ['Bangalore 1','Team Lead','Chaithanya M','Romen Singh','RH'],
  ['Bangalore 1','Team Lead','Krishna Murthy','Mukesh Mishra','CH'],
  ['Bangalore 1','Team Lead','Mainuddin T','Romen Singh','RH'],
  ['Bangalore 1','Team Lead','dummy rm','admin homesfy','Admin'],
  ['Bangalore 1','RM','Abdur Rahim','Mainuddin T','A1'],
  ['Bangalore 1','RM','Chaithanya M S 1 Account','Chaithanya M','A1'],
  ['Bangalore 1','RM','Chandana n r','Chaithanya M','A1'],
  ['Bangalore 1','RM','Divakar V','Chaithanya M','A1'],
  ['Bangalore 1','RM','Mahesh V','Rahan Khan','A1'],
  ['Bangalore 1','RM','Manoj M','Krishna Murthy','A1'],
  ['Bangalore 1','RM','Md Muzamil','Mainuddin T','A1'],
  ['Bangalore 1','RM','Mhd Haseebulla','Krishna Murthy','A1'],
  ['Bangalore 1','RM','Mohammed Hidayathulla','Chaithanya M','A1'],
  ['Bangalore 1','RM','Neelam Singh','Chaithanya M','A1'],
  ['Bangalore 1','RM','Praveen R','Krishna Murthy','A1'],
  ['Bangalore 1','RM','Rahul Singh','Krishna Murthy','A1'],
  ['Bangalore 1','RM','Romen Singh S 1 Account','Romen Singh','RH'],
  ['Bangalore 1','RM','Sippal Khora','Chaithanya M','A1'],
  ['Bangalore 1','RM','Suman Das','Mainuddin T','A1'],
  ['Bangalore 1','RM','Vishnu Vardhan S 1 Account','R G Vishnu Vardhan','A1'],
  ['Bangalore 1','RM','Zain Ahmed','Chaithanya M','A1'],
  ['Bangalore 2','Team Lead','Rahan Khan','Romen Singh','RH'],
  ['Bangalore 2','RM','Kiran Kumar T','R G Vishnu Vardhan','A1'],
  ['Bangalore 2','RM','Rahan Khan S 1','Rahan Khan','A1'],
  ['Bangalore 2','RM','Sahil kumar s','Chaithanya M','A1'],
  ['Bangalore 2','RM','Sangam S','Krishna Murthy','A1'],
  ['Bangalore 2','RM','Sona V','Rahan Khan','A1'],
  ['Bangalore 2','RM','Vijay Kumar E','Rahan Khan','A1'],
  ['Bangalore 2','RM','Vyshnavi Singh','Rahan Khan','A1'],
  ['Central','Team Lead','Kumar Babu','Rajkumar Ombase','RH'],
  ['Central','Team Lead','Mukesh Yadav','Rajkumar Ombase','RH'],
  ['Central','Team Lead','Prajwal Shetty','Akash Ugale','RH'],
  ['Central','Team Lead','Sachin Rana','Rajkumar Ombase','RH'],
  ['Central','RM','Fakrealam Ansari','Kumar Babu','A1'],
  ['Central','RM','Farid Shaikh','Prajwal Shetty','A1'],
  ['Central','RM','Karan Shinde','Mukesh Yadav','A1'],
  ['Central','RM','Khushal Soni','Sachin Rana','A1'],
  ['Central','RM','Kishan Patel','Akash Ugale','RH'],
  ['Central','RM','Mayuresh Chavan','Mukesh Yadav','A1'],
  ['Central','RM','Mihir Jivani','Sachin Rana','A1'],
  ['Central','RM','Mustakim sayyad','Prajwal Shetty','A1'],
  ['Central','RM','Prajwal Shetty S 1 Account','Prajwal Shetty','A1'],
  ['Central','RM','Purvesh Ugawekar','Akash Ugale','RH'],
  ['Central','RM','Rohit Gaud','-','-'],
  ['Central','RM','Rohit Gupta','Kumar Babu','A1'],
  ['Central','RM','Sanjay Gupta','Kumar Babu','A1'],
  ['Central','RM','Saurabh Pacharne','Kumar Babu','A1'],
  ['Central','RM','Shital Bhagwane','Mukesh Yadav','A1'],
  ['Central','RM','Shubham Raj','Sachin Rana','A1'],
  ['Central','RM','Sneha Upadhyay','Kumar Babu','A1'],
  ['Central','RM','Sumeet Pal','Prajwal Shetty','A1'],
  ['Central','RM','Vivek Yadav','Mukesh Yadav','A1'],
  ['Central','RM','Zeya Shaikh','Mukesh Yadav','A1'],
  ['Central','RM','gurmohit singh sandhu','Sachin Rana','A1'],
  ['Commercial','RM','neha mishra','Neha Mishra Ch','CH'],
  ['Delhi','Team Lead','Mayur Gera','ashish kukreja ceo','Admin'],
  ['Godrej','RM','Dhanashree Paunikar','Anupam Mishra','CH'],
  ['Godrej','RM','Varad Tela','Anupam Mishra','CH'],
  ['HNI - SoBo','Team Lead','Pritesh Shankhat','Abhhijjit Gandhii','CH'],
  ['HNI - SoBo','RM','Adil Shaikh','Pritesh Shankhat','A1'],
  ['HNI - SoBo','RM','Hetal Gohil','Pritesh Shankhat','A1'],
  ['HNI - SoBo','RM','Jyoti Sharma','Abhhijjit Gandhii','CH'],
  ['HNI - SoBo','RM','Mohd Shaikh','Abhhijjit Gandhii','CH'],
  ['HNI - SoBo','RM','Sagar Shelar','Abhhijjit Gandhii','CH'],
  ['HNI - SoBo','RM','Sahil Gupta','Pritesh Shankhat','A1'],
  ['HNI - SoBo','RM','Shivani Ilahabadi','Pritesh Shankhat','A1'],
  ['HNI - SoBo','RM','Yashodeep Kubavat','Abhhijjit Gandhii','CH'],
  ['Harbour','Team Lead','Yash Sharma','Sanjyota Bhosale','CH'],
  ['Harbour','Team Lead','a one salestl','Sr A Test','RH'],
  ['Harbour','RM','Aakash Dhole','Yash Sharma','A1'],
  ['Harbour','RM','Atharva P Belose','Yash Sharma','A1'],
  ['Harbour','RM','Dhiraj Chhoda','Yash Sharma','A1'],
  ['Harbour','RM','Dummy Sane','a one salestl','A1'],
  ['Harbour','RM','Nitin Devariya','Yash Sharma','A1'],
  ['Harbour','RM','bisma Shah','Yash Sharma','A1'],
  ['Hyderabad','Team Lead','Vemula Ajay','Mukesh Mishra','CH'],
  ['Hyderabad','RM','Chandrashaker Gurram','r raja arun kumar','A1'],
  ['Hyderabad','RM','Maagathoti Adilakshmi','Vemula Ajay','A1'],
  ['Hyderabad','RM','Parusharothu vinay varma','Vemula Ajay','A1'],
  ['Hyderabad','RM','Peddapally Shivaji','Vemula Ajay','A1'],
  ['Hyderabad','RM','Shamakuri Goud','Vemula Ajay','A1'],
  ['Hyderabad','RM','Vadlapudi Divya','Vemula Ajay','A1'],
  ['Hyderabad','RM','g Kumar','Vemula Ajay','A1'],
  ['KDMC','RM','Ayan Jamsheed','Swapnil Gowalkar','RH'],
  ['KDMC','RM','Rahul Test','Sr A Test','RH'],
  ['KDMC','RM','Sagar mahamuni kdmc','Bipin More','CH'],
  ['KDMC','RM','manisha Kale','a one salestl','A1'],
  ['Mumbai-Miscellaneous','RM','Craft Booking','-','-'],
  ['Navi Mumbai','Team Lead','Avinash Kumar','Vidya Jadhav','CH'],
  ['Navi Mumbai','RM','Aditya Jumledaar','Vidya Jadhav','CH'],
  ['Navi Mumbai','RM','Amit Rathod','Avinash Kumar','A1'],
  ['Navi Mumbai','RM','Ashish Kadam','Avinash Kumar','A1'],
  ['Navi Mumbai','RM','Avinash Kumar S 1 Account','Avinash Kumar','A1'],
  ['Navi Mumbai','RM','Chandni Khatoon','Vidya Jadhav','CH'],
  ['Navi Mumbai','RM','Chandrakant Bhagat','Sampada Pawar','RH'],
  ['Navi Mumbai','RM','Harshith S','Sampada Pawar','RH'],
  ['Navi Mumbai','RM','Jayesh Parab','Avinash Kumar','A1'],
  ['Navi Mumbai','RM','Jitendra Phulwaria','Vidya Jadhav','CH'],
  ['Navi Mumbai','RM','Jyoti Ram','Avinash Kumar','A1'],
  ['Navi Mumbai','RM','Kartik Shirsat','Sampada Pawar','RH'],
  ['Navi Mumbai','RM','Mohd Yaqub Nawab','Sampada Pawar','RH'],
  ['Navi Mumbai','RM','Prachi Chouhan','Sampada Pawar','RH'],
  ['Navi Mumbai','RM','Rinky Bidare','Sampada Pawar','RH'],
  ['Navi Mumbai','RM','Rutuja Daule','Sampada Pawar','RH'],
  ['Navi Mumbai','RM','Shahnavaz Shaikh','Avinash Kumar','A1'],
  ['Navi Mumbai','RM','Sharanjeet Atwal','Vidya Jadhav','CH'],
  ['Navi Mumbai','RM','Shubham Buchade','Avinash Kumar','A1'],
  ['Navi Mumbai','RM','Siddharth Sharma','Vidya Jadhav','CH'],
  ['Navi Mumbai','RM','Suman Pujari','Avinash Kumar','A1'],
  ['Navi Mumbai','RM','Tejal Nikam','Avinash Kumar','A1'],
  ['Navi Mumbai','RM','Vidya S 1 Account','Vidya Jadhav','CH'],
  ['Navi Mumbai','RM','joshi dhairya','Vidya Jadhav','CH'],
  ['Pune East','Team Lead','Nishant anand','Sachindra Wadane','RH'],
  ['Pune East','Team Lead','Omkar Ghate','Ayaz Bagwan','RH'],
  ['Pune East','Team Lead','firoj shaikh','Ayaz Bagwan','RH'],
  ['Pune East','RM','Aabid Khan','firoj shaikh','A1'],
  ['Pune East','RM','Akash Jogdand','Rohit Rathod','A1'],
  ['Pune East','RM','Arpita Varte','Ayaz Bagwan','RH'],
  ['Pune East','RM','Chaitali Patil','Nishant anand','A1'],
  ['Pune East','RM','Gouttam Aicha','Nishant anand','A1'],
  ['Pune East','RM','Mahesh Mahore','Sachindra Wadane','RH'],
  ['Pune East','RM','Nagesh Maharnavar','Ayaz Bagwan','RH'],
  ['Pune East','RM','Nagnath Dhotre','Nishant anand','A1'],
  ['Pune East','RM','Nikhil Sarwade','Sachindra Wadane','RH'],
  ['Pune East','RM','Pravin Kharat','Ayaz Bagwan','RH'],
  ['Pune East','RM','Rahul Panherkar','Sachindra Wadane','RH'],
  ['Pune East','RM','Ramesh Kudale','Omkar Ghate','A1'],
  ['Pune East','RM','Ritik Minekar','Nishant anand','A1'],
  ['Pune East','RM','Sachinder Singh','Sourabh Sareen','CH'],
  ['Pune East','RM','Sahil Gote','Sachindra Wadane','RH'],
  ['Pune East','RM','Santosh Khandare','Sachindra Wadane','RH'],
  ['Pune East','RM','Shailesh Tiwari','Sachindra Wadane','RH'],
  ['Pune East','RM','Siddhesh bhagwat','Sachindra Wadane','RH'],
  ['Pune East','RM','Somanath Sangle','Nishant anand','A1'],
  ['Pune East','RM','Souvik Biswas','Sachindra Wadane','RH'],
  ['Pune East','RM','Soyeb Akhtar','firoj shaikh','A1'],
  ['Pune East','RM','Swapnil Waghmode','Nishant anand','A1'],
  ['Pune East','RM','Vaibhav Bhadkumbe','Ayaz Bagwan','RH'],
  ['Pune East','RM','Vishwanath Zalake','Ayaz Bagwan','RH'],
  ['Pune East','RM','Vivek Solanke','Nishant anand','A1'],
  ['Pune North','Team Lead','Rohit Rathod','Sachindra Wadane','RH'],
  ['Pune North','RM','Om Potdar','Rohit Rathod','A1'],
  ['Pune North','RM','Preeti Sah','Rohit Rathod','A1'],
  ['Pune North','RM','Prem Chand Mishra','Rohit Rathod','A1'],
  ['Pune North','RM','Rajdeep Jalan','Rohit Rathod','A1'],
  ['Pune South','RM','Israr Khan','firoj shaikh','A1'],
  ['Pune South','RM','Nagmma Mujnayak','Ayaz Bagwan','RH'],
  ['Pune South','RM','Pramod Ghaytadak','Omkar Ghate','A1'],
  ['Pune South','RM','Ravi Pandey','Nishant anand','A1'],
  ['Pune South','RM','Shaikh Wasim Shaikh Harun','Omkar Ghate','A1'],
  ['Pune West','Team Lead','Prathamesh a pande','Rahul Poudel','RH'],
  ['Pune West','Team Lead','nayan Pabale','Rahul Poudel','RH'],
  ['Pune West','RM','Abhikesh Kumar','Rahul Poudel','RH'],
  ['Pune West','RM','Adinath Munde','Rahul Poudel','RH'],
  ['Pune West','RM','Aditya Tripathi','nayan Pabale','A1'],
  ['Pune West','RM','Akshay Dawle','nayan Pabale','A1'],
  ['Pune West','RM','Akshay More','Prathamesh a pande','A1'],
  ['Pune West','RM','Arbaj Shaikh','Rahul Poudel','RH'],
  ['Pune West','RM','Buddhabhushan Wakode','Rahul Poudel','RH'],
  ['Pune West','RM','Gaurav Gunjal','nayan Pabale','A1'],
  ['Pune West','RM','Kapil Biyani','ranjeet kumar','A1'],
  ['Pune West','RM','Krish Sinha','nayan Pabale','A1'],
  ['Pune West','RM','Pranav Deshmukh','Prathamesh a pande','A1'],
  ['Pune West','RM','Rahul Raj','nayan Pabale','A1'],
  ['Pune West','RM','Rukhsar Nasir','arijit saha','CH'],
  ['Pune West','RM','Tarush Dhingra','Rahul Poudel','RH'],
  ['Pune West','RM','Yash Awade','Prathamesh a pande','A1'],
  ['Pune West','RM','aadesh Narwade','Prathamesh a pande','A1'],
  ['SoBo','RM','Manan Bhatt','Yash Sharma','A1'],
  ['SoBo','RM','mohammed Khan','Pritesh Shankhat','A1'],
  ['Thane','Team Lead','Amit Upadhyay','Bipin More','CH'],
  ['Thane','Team Lead','Ganesh Saroj','Swapnil Gowalkar','RH'],
  ['Thane','Team Lead','Niraj Patil','Swapnil Gowalkar','RH'],
  ['Thane','Team Lead','Sanket Yadav','Bipin More','CH'],
  ['Thane','RM','Akash Gaikwad','Niraj Patil','A1'],
  ['Thane','RM','Aman Gupta','Amit Upadhyay','A1'],
  ['Thane','RM','Amit S 1 Account','Amit Upadhyay','A1'],
  ['Thane','RM','Arbaaz Ansari','Amit Upadhyay','A1'],
  ['Thane','RM','Avinash Das','Ganesh Saroj','A1'],
  ['Thane','RM','Avinash Khare','Ganesh Saroj','A1'],
  ['Thane','RM','Bipin More S 1','Bipin More','CH'],
  ['Thane','RM','Divya Rohela','Swapnil Gowalkar','RH'],
  ['Thane','RM','Harshada Landge','Sanket Yadav','A1'],
  ['Thane','RM','Hitesh Jaiswar','Amit Upadhyay','A1'],
  ['Thane','RM','Jay Patil','Niraj Patil','A1'],
  ['Thane','RM','Kamlesh Tawale','Swapnil Gowalkar','RH'],
  ['Thane','RM','Kishan Lohar','Amit Upadhyay','A1'],
  ['Thane','RM','Madhavi Pawar','Ganesh Saroj','A1'],
  ['Thane','RM','Mahendra Demo','a one salestl','A1'],
  ['Thane','RM','Mamtaben Sosa','Amit Upadhyay','A1'],
  ['Thane','RM','Mohd Adnan Malik','Amit Upadhyay','A1'],
  ['Thane','RM','Mohit Manwani','Sanket Yadav','A1'],
  ['Thane','RM','Niraj Patil S 1 Account','Niraj Patil','A1'],
  ['Thane','RM','Prem Sutar','Ganesh Saroj','A1'],
  ['Thane','RM','Rahul Chauhan','Ganesh Saroj','A1'],
  ['Thane','RM','Ranjana Dubey','Niraj Patil','A1'],
  ['Thane','RM','Riyan Jamadar','Sanket Yadav','A1'],
  ['Thane','RM','Roshan Pandey','Sanket Yadav','A1'],
  ['Thane','RM','Sagar Mahamuni','Niraj Patil','A1'],
  ['Thane','RM','Sajid Mulani','Amit Upadhyay','A1'],
  ['Thane','RM','Sandeep V','Bipin More','CH'],
  ['Thane','RM','Sanket Yadav','Sanket Yadav','A1'],
  ['Thane','RM','Saurabh M S','Niraj Patil','A1'],
  ['Thane','RM','Soham Yadav','Ganesh Saroj','A1'],
  ['Thane','RM','Sunny Saini','Amit Upadhyay','A1'],
  ['Thane','RM','Vishal Chavan','Swapnil Gowalkar','RH'],
  ['Thane 2','RM','Aditya Gera','-','-'],
  ['Thane 2','RM','Angad Yadav','-','-'],
  ['Thane 2','RM','Caller Thane Dummy','Niraj Patil','A1'],
  ['Thane 2','RM','Ganesh Saroj Dummy','Ganesh Saroj','A1'],
  ['Thane 2','RM','Shivnath Dummy','Shivanath Bhairwadgi','A1'],
  ['Thane 2','RM','Swapnil Bhosale','-','-'],
  ['Unassigned','RM','Akhil Uniyal','-','-'],
  ['Unassigned','RM','Harshal Kokate','anshuman kasera','CH'],
  ['Unassigned','RM','Krishnakant Singh','Roopak Desai','A1'],
  ['Unassigned','RM','Rohit Sharma','ashutosh mishra','RH'],
  ['Unassigned','RM','ameya suresh sawant','rh soha','CH'],
  ['Unassigned','RM','amit gupta','-','-'],
  ['Unassigned','RM','annjali makwana','-','-'],
  ['Unassigned','RM','archana bhanushali','-','-'],
  ['Unassigned','RM','art','-','-'],
  ['Unassigned','RM','dummy sales','-','-'],
  ['Unassigned','RM','gauri chavan','-','-'],
  ['Unassigned','RM','guest western 1','-','-'],
  ['Unassigned','RM','guest western 2','-','-'],
  ['Unassigned','RM','jay sawant','-','-'],
  ['Unassigned','RM','kritika jhaa','anshuman kasera','CH'],
  ['Unassigned','RM','lead dump','-','-'],
  ['Unassigned','RM','nri crm','-','-'],
  ['Unassigned','RM','rama gokhale','-','-'],
  ['Unassigned','RM','resale leads','-','-'],
  ['Unassigned','RM','sachin more','-','-'],
  ['Unassigned','RM','samiksha yadav','-','-'],
  ['Unassigned','RM','santosh chavan','-','-'],
  ['Unassigned','RM','shreeyanch','-','-'],
  ['Unassigned','RM','sneha dhangar','-','-'],
  ['Unassigned','RM','sugesh b. doifode','-','-'],
  ['Unassigned','RM','sumit ghorpade','-','-'],
  ['Unassigned','RM','surajit mondal','Rachana Chandankar','A1'],
  ['Unassigned','RM','thane user 1','Bipin More','CH'],
  ['Unassigned','RM','thane user 2','-','-'],
  ['Unassigned','RM','tushar salunkhe','-','-'],
  ['Wakanda','RM','Ashish Rm','Sandeep Vadnere','Admin'],
  ['Wakanda','RM','Futwork Test','chetan verma','RH'],
  ['Wakanda','RM','Tech Internal A','babita tandi','S2'],
  ['Wakanda','RM','Vaibhav Tech','-','-'],
  ['Wakanda','RM','Vaibhav Uke','babita tandi','S2'],
  ['Western','Team Lead','Prathmesh s pandey','Rahul Gandhi','CH'],
  ['Western','RM','Arbaz Patel','Prathmesh s pandey','A1'],
  ['Western','RM','Eknidhi Chabra','Minas Patel','RH'],
  ['Western','RM','Gajanan Jadhav','Minas Patel','RH'],
  ['Western','RM','Kundan Singh','Prathmesh s pandey','A1'],
  ['Western','RM','Lalita Yadav','Prathmesh s pandey','A1'],
  ['Western','RM','Lovkesh Pandey','Prathmesh s pandey','A1'],
  ['Western','RM','Mangesh Pal','Prathmesh s pandey','A1'],
  ['Western','RM','Prathmesh S 1','Prathmesh s pandey','A1'],
  ['Western','RM','Rahul S 1','Rahul Gandhi','CH'],
  ['Western','RM','Riya Yadav','Minas Patel','RH'],
  ['Western','RM','Saravash Upadhyay','Minas Patel','RH'],
  ['Western','RM','Saurabh Pandey','Prathmesh s pandey','A1'],
  ['Western','RM','Shweta Shende Dummy','Minas Patel','RH'],
  ['Western','RM','Sonam Dubey','Minas Patel','RH'],
  ['Western','RM','Vijay Katheriya','Minas Patel','RH'],
  ['Western','RM','Vijay Yadav','Prathmesh s pandey','A1'],
  ['Western','RM','Yash Kandhare','Prathmesh s pandey','A1'],
  ['Western','RM','pratapkumar Yadav','Minas Patel','RH'],
  ['Western 2','RM','Radhika thakkar dummy','Minas Patel','RH'],
];

// Case/whitespace-normalized name — used to match a person's name in
// RM_HIERARCHY_RAW_ against RmHierarchy.private.gs's separately-exported
// email table (two independently exported files with no shared ID, so
// name text is the only link between them, and the two spell some names
// slightly differently: case, extra spaces, a trailing period).
function normPersonName_(name) {
  return String(name || '').trim().toLowerCase().replace(/\s+/g, ' ').replace(/\.$/, '');
}

// RmHierarchy.private.gs — a companion Apps Script file, deliberately NOT
// committed to this PUBLIC repo (it embeds real employee email addresses;
// see its own header) — defines EMPLOYEE_EMAIL_BY_NAME_RAW_, nothing else.
// Guarded with typeof so this file works standalone (every email just
// comes back blank, nothing throws) if that companion hasn't been added
// to the Apps Script project yet.
//
// The lookup table is built HERE, lazily, on first call — not at file-load
// time in either file. Apps Script evaluates each file's top-level code
// independently and does NOT guarantee one file's declarations exist yet
// when another file's top-level code runs — building this eagerly at load
// time (this file or RmHierarchy.private.gs) produced a real
// "ReferenceError: normPersonName_ is not defined" in production the
// first time this shipped, because RmHierarchy.private.gs's top-level
// code ran before this file's normPersonName_ existed. Deferring
// construction to the first actual FUNCTION CALL sidesteps that
// entirely — by the time any real Apps Script function runs (a trigger,
// a manual Run), every file has already finished loading.
let _employeeEmailLookupCache_ = null;
function lookupEmployeeEmail_(name) {
  if (typeof EMPLOYEE_EMAIL_BY_NAME_RAW_ === 'undefined') return '';
  if (!_employeeEmailLookupCache_) {
    _employeeEmailLookupCache_ = {};
    EMPLOYEE_EMAIL_BY_NAME_RAW_.forEach(function (r) { _employeeEmailLookupCache_[normPersonName_(r[0])] = r[1]; });
  }
  return _employeeEmailLookupCache_[normPersonName_(name)] || '';
}


// ---- Dummy / test / placeholder account detection ----
// Pre-ticks the "Excluded" checkbox in RM_Hierarchy for accounts that are
// clearly not real RMs — a human reviews and can un-tick any of these.
const DUMMY_NAME_PATTERNS_ = [/\bdummy\b/i, /\btest\b/i, /\bdemo\b/i, /\bs\s?1(\s+account)?\s*$/i];
const DUMMY_EXACT_NAMES_ = new Set([
  'craft booking', 'lead dump', 'nri crm', 'resale leads', 'art',
  'tech internal a', 'guest western 1', 'guest western 2',
  'a one salestl', 'sr a test', 'dummy sales',
]);
// Entire region is a sandbox used for internal/QA testing, not real sales —
// every row under it is excluded regardless of individual name.
const DUMMY_REGIONS_ = new Set(['wakanda']);

function isDummyRow_(region, name, reportsTo) {
  const n = String(name || '').trim();
  const nLower = n.toLowerCase();
  if (DUMMY_REGIONS_.has(String(region || '').trim().toLowerCase())) {
    return 'Sandbox/test region (Wakanda)';
  }
  if (DUMMY_EXACT_NAMES_.has(nLower)) return 'Known placeholder/system account name';
  for (let i = 0; i < DUMMY_NAME_PATTERNS_.length; i++) {
    if (DUMMY_NAME_PATTERNS_[i].test(n)) return 'Name pattern suggests a test/dummy sub-account';
  }
  if (nLower && nLower === String(reportsTo || '').trim().toLowerCase()) {
    return 'Reports to a person with the exact same name (self-referencing test account)';
  }
  return '';
}

/**
 * Resolves the full RM_HIERARCHY_RAW_ table into one row per person with
 * TL/RH/CH/Other columns filled in from whatever their ACTUAL chain is —
 * not a fixed number of hops. Returns an array of row objects; does not
 * touch any sheet (pure function, easy to test in isolation).
 */
function resolveRmHierarchy_() {
  // A separate map keyed to ONLY Team Lead rows: an "A1"-tagged manager
  // name is always looked up as a Team Lead specifically, never an RM — if
  // this used one shared name->row map instead, a Team Lead and an RM who
  // happen to share a name (e.g. a self-reporting dummy "Sanket Yadav" RM
  // row alongside the real Team Lead "Sanket Yadav") would shadow each
  // other depending on array order, silently losing the real TL's RH/CH.
  const byTlName = {};
  RM_HIERARCHY_RAW_.forEach(function (r) { if (r[1] === 'Team Lead') byTlName[r[2].trim().toLowerCase()] = r; });

  return RM_HIERARCHY_RAW_.map(function (r) {
    const region = r[0], role = r[1], name = r[2], reportsTo = r[3], reportsToRole = r[4];
    const out = {
      region: region, role: role, name: name, reportsTo: reportsTo, reportsToRole: reportsToRole,
      tl: '', rh: '', ch: '', other: '', otherRole: '', note: '',
      email: lookupEmployeeEmail_(name),
    };
    const excludeReason = isDummyRow_(region, name, reportsTo);

    function applyDirect(mgrName, mgrRole) {
      if (mgrRole === 'RH') out.rh = mgrName;
      else if (mgrRole === 'CH') out.ch = mgrName;
      else if (mgrRole === 'Admin' || mgrRole === 'S2') { out.other = mgrName; out.otherRole = mgrRole; }
      // '-' (no manager) or anything unrecognised: leave everything blank.
    }

    if (reportsToRole === 'A1') {
      // Immediate manager is presumed to be a Team Lead — look up THEIR row
      // to find what's above them (RH/CH/Admin, per the source data never
      // another A1 — Team Leads never report to another Team Lead here).
      out.tl = reportsTo;
      const tlRow = byTlName[String(reportsTo).trim().toLowerCase()];
      if (tlRow) {
        applyDirect(tlRow[3], tlRow[4]);
        if (tlRow[4] === '-') out.note = 'Team Lead "' + reportsTo + '" has no manager on file — issue can only reach the TL.';
      } else {
        out.note = 'Manager "' + reportsTo + '" (tagged A1) has no Team Lead row of their own in the source file — RH/CH above them could not be resolved. Fill in manually if needed.';
      }
    } else {
      // Reports directly to RH/CH/Admin/S2/nobody — no Team Lead hop.
      applyDirect(reportsTo, reportsToRole);
      if (reportsToRole === '-') out.note = 'No manager on file for this person.';
    }

    out.excluded = !!excludeReason;
    out.excludeReason = excludeReason;
    return out;
  });
}

// Split into small, independently-retried steps (rather than one big
// withRetry_ around the whole create-and-fill sequence) so a transient
// "Service Spreadsheets timed out" on, say, the checkbox insertion doesn't
// force redoing the sheet creation and the ~270-row data write too — each
// step pays its own retry cost, not the whole sequence's. Real production
// hit exactly this on the heavier rebuildRmHierarchy() below; the same
// shape applies here for the same reason.
function ensureRmHierarchySheet_(ss) {
  const existing = withRetry_(function () { return ss.getSheetByName(RM_HIERARCHY_SHEET_); }, 'check for existing RM_Hierarchy');
  if (existing) return existing; // already set up — use rebuildRmHierarchy() to refresh from source

  const resolved = resolveRmHierarchy_();
  const headers = ['region', 'role', 'name', 'reports_to', 'reports_to_role', 'tl', 'rh', 'ch', 'other_manager', 'other_manager_role', 'excluded', 'exclude_reason', 'note', 'email'];
  const rows = resolved.map(function (p) {
    return [p.region, p.role, p.name, p.reportsTo, p.reportsToRole, p.tl, p.rh, p.ch, p.other, p.otherRole, p.excluded, p.excludeReason, p.note, p.email];
  });

  const sheet = withRetry_(function () { return ss.insertSheet(RM_HIERARCHY_SHEET_); }, 'insert RM_Hierarchy');
  // A sheet just created by insertSheet() isn't always fully settled on
  // Google's end the instant the call returns — writing to it immediately
  // is exactly the pattern that kept producing "Service Spreadsheets timed
  // out" in production even with a widened retry budget. flush() forces
  // every pending change (including the insert itself) to actually commit
  // before the next operation starts, which is Google's own documented fix
  // for this class of issue.
  SpreadsheetApp.flush();
  withRetry_(function () {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
  }, 'write RM_Hierarchy header');
  withRetry_(function () { sheet.getRange(2, 1, rows.length, headers.length).setValues(rows); }, 'write RM_Hierarchy data rows');
  withRetry_(function () { sheet.getRange(2, 11, rows.length, 1).insertCheckboxes(); }, 'insert RM_Hierarchy checkboxes');
  return sheet;
}

/**
 * Rebuilds RM_Hierarchy from the current RM_HIERARCHY_RAW_ table (e.g.
 * after pasting in a fresh export), while PRESERVING every manual edit a
 * human made in the existing sheet — Excluded checkbox and Note, matched
 * by person name (case-insensitive). New people get this script's default
 * exclusion guess; people no longer in the source table are dropped.
 */
function rebuildRmHierarchy() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const headers = ['region', 'role', 'name', 'reports_to', 'reports_to_role', 'tl', 'rh', 'ch', 'other_manager', 'other_manager_role', 'excluded', 'exclude_reason', 'note', 'email'];

  const priorByName = {};
  withRetry_(function () {
    const sheet = ss.getSheetByName(RM_HIERARCHY_SHEET_);
    if (!sheet) return;
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return;
    // Old sheets (before the email column existed) have 13 columns — read
    // whatever's there rather than assuming headers.length, so row[13] just
    // comes back undefined/blank on those instead of erroring.
    const lastCol = Math.max(sheet.getLastColumn(), headers.length);
    sheet.getRange(2, 1, lastRow - 1, lastCol).getValues().forEach(function (row) {
      const name = String(row[2] || '').trim().toLowerCase();
      if (!name) return;
      priorByName[name] = { excluded: row[10], excludeReason: String(row[11] || ''), note: String(row[12] || ''), email: String(row[13] || '') };
    });
  }, 'read existing RM_Hierarchy before rebuild');

  const resolved = resolveRmHierarchy_();
  const rows = resolved.map(function (p) {
    const prior = priorByName[p.name.trim().toLowerCase()];
    // A human-entered note/exclude-reason/email survives untouched; only
    // fall back to this script's own guess (or the Book7 auto-lookup, for
    // email) when there's no prior row for this person.
    const excluded = prior ? prior.excluded : p.excluded;
    const excludeReason = prior && prior.excludeReason ? prior.excludeReason : p.excludeReason;
    const note = prior && prior.note ? prior.note : p.note;
    const email = prior && prior.email ? prior.email : p.email;
    return [p.region, p.role, p.name, p.reportsTo, p.reportsToRole, p.tl, p.rh, p.ch, p.other, p.otherRole, excluded, excludeReason, note, email];
  });

  // Same reasoning as ensureRmHierarchySheet_ above: small independently-
  // retried steps instead of one withRetry_ around delete+recreate+write+
  // checkboxes, so a transient timeout on one step doesn't force redoing
  // everything before it. This is exactly what production hit: "rewrite
  // RM_Hierarchy" timing out on all 3 attempts because each attempt had to
  // redo the delete, the insert, AND the full ~270-row write before even
  // reaching the checkbox step.
  withRetry_(function () {
    const existing = ss.getSheetByName(RM_HIERARCHY_SHEET_);
    if (existing) ss.deleteSheet(existing);
  }, 'delete old RM_Hierarchy');
  SpreadsheetApp.flush(); // let the delete actually commit before recreating the same-named sheet
  const sheet = withRetry_(function () { return ss.insertSheet(RM_HIERARCHY_SHEET_); }, 'insert RM_Hierarchy');
  // See ensureRmHierarchySheet_'s identical comment — a freshly inserted
  // sheet isn't always immediately ready for a write; this is the step
  // that kept timing out in production even at 4 retry attempts.
  SpreadsheetApp.flush();
  withRetry_(function () {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
  }, 'write RM_Hierarchy header');
  withRetry_(function () { sheet.getRange(2, 1, rows.length, headers.length).setValues(rows); }, 'write RM_Hierarchy data rows');
  withRetry_(function () { sheet.getRange(2, 11, rows.length, 1).insertCheckboxes(); }, 'insert RM_Hierarchy checkboxes');

  ensureManagerDirectorySheetInternal_(ss, true);
  Logger.log('RM_Hierarchy rebuilt: ' + rows.length + ' people. Manager_Directory refreshed (emails preserved).');
}

// Same small-independently-retried-steps shape as ensureRmHierarchySheet_/
// rebuildRmHierarchy above, for the same reason — one big withRetry_ around
// delete+recreate+write makes every retry redo the whole thing.
function ensureManagerDirectorySheetInternal_(ss, forceRefresh) {
  const existing = withRetry_(function () { return ss.getSheetByName(MANAGER_DIRECTORY_SHEET_); }, 'check for existing Manager_Directory');
  if (existing && !forceRefresh) return existing;

  const priorEmails = {};
  if (existing) {
    withRetry_(function () {
      const lastRow = existing.getLastRow();
      if (lastRow < 2) return;
      existing.getRange(2, 1, lastRow - 1, 4).getValues().forEach(function (row) {
        const name = String(row[0] || '').trim().toLowerCase();
        const email = String(row[3] || '').trim();
        if (name && email) priorEmails[name] = email;
      });
    }, 'read existing Manager_Directory emails');
  }

  const resolved = resolveRmHierarchy_();
  const byManager = {}; // lowercased name -> {name, roles:Set, regions:Set, reportCount}
  function record(name, role, region) {
    if (!name) return;
    const key = name.trim().toLowerCase();
    if (!byManager[key]) byManager[key] = { name: name.trim(), roles: new Set(), regions: new Set(), reportCount: 0 };
    byManager[key].roles.add(role);
    byManager[key].regions.add(region);
    byManager[key].reportCount++;
  }
  resolved.forEach(function (p) {
    if (p.excluded) return; // dummy/test accounts don't create a manager-directory entry on their own
    if (p.tl) record(p.tl, 'TL', p.region);
    if (p.rh) record(p.rh, 'RH', p.region);
    if (p.ch) record(p.ch, 'CH', p.region);
    if (p.other) record(p.other, p.otherRole || 'Other', p.region);
  });

  const names = Object.keys(byManager).sort();
  const rows = names.map(function (key) {
    const m = byManager[key];
    // A human-entered email (however it got there) always wins over the
    // Book7 auto-lookup — never overwrite what someone already typed in.
    const priorEmail = priorEmails[key] || '';
    const autoEmail = lookupEmployeeEmail_(m.name);
    const email = priorEmail || autoEmail;
    const emailSource = priorEmail ? 'manual' : (autoEmail ? 'Book7 auto-match' : '');
    return [m.name, Array.from(m.roles).sort().join(', '), Array.from(m.regions).sort().join(', '), email, m.reportCount, emailSource];
  });

  if (existing) {
    withRetry_(function () { ss.deleteSheet(existing); }, 'delete old Manager_Directory');
    SpreadsheetApp.flush(); // let the delete actually commit before recreating the same-named sheet
  }
  const sheet = withRetry_(function () { return ss.insertSheet(MANAGER_DIRECTORY_SHEET_); }, 'insert Manager_Directory');
  // See ensureRmHierarchySheet_'s identical comment — a freshly inserted
  // sheet isn't always immediately ready for a write.
  SpreadsheetApp.flush();
  withRetry_(function () {
    sheet.getRange(1, 1, 1, 6).setValues([['manager_name', 'roles', 'regions', 'email', 'people_reporting_up_to_them', 'email_source']]);
    sheet.setFrozenRows(1);
  }, 'write Manager_Directory header');
  if (rows.length) withRetry_(function () { sheet.getRange(2, 1, rows.length, 6).setValues(rows); }, 'write Manager_Directory data rows');
  return sheet;
}

function ensureManagerDirectorySheet_(ss) {
  return ensureManagerDirectorySheetInternal_(ss, false);
}

/**
 * Reads RM_Hierarchy + Manager_Directory back from the sheets (the live,
 * human-editable source of truth — not the embedded RM_HIERARCHY_RAW_
 * table directly) into: { byRmNameLower: {tl, rh, ch, other, otherRole,
 * excluded}, emailByManagerNameLower: string }. Used by
 * OvernightEmailer.gs to resolve recipients at send time.
 */
function loadRmHierarchyAndEmails_(ss) {
  ensureRmHierarchySheet_(ss);
  ensureManagerDirectorySheet_(ss);
  return withRetry_(function () {
    const hierarchySheet = ss.getSheetByName(RM_HIERARCHY_SHEET_);
    const hLastRow = hierarchySheet.getLastRow();
    const byRmNameLower = {};
    if (hLastRow >= 2) {
      hierarchySheet.getRange(2, 1, hLastRow - 1, 13).getValues().forEach(function (row) {
        const name = String(row[2] || '').trim();
        if (!name) return;
        byRmNameLower[name.toLowerCase()] = {
          tl: String(row[5] || '').trim(), rh: String(row[6] || '').trim(),
          ch: String(row[7] || '').trim(), other: String(row[8] || '').trim(),
          otherRole: String(row[9] || '').trim(), excluded: !!row[10],
        };
      });
    }

    const directorySheet = ss.getSheetByName(MANAGER_DIRECTORY_SHEET_);
    const dLastRow = directorySheet.getLastRow();
    const emailByManagerNameLower = {};
    if (dLastRow >= 2) {
      directorySheet.getRange(2, 1, dLastRow - 1, 4).getValues().forEach(function (row) {
        const name = String(row[0] || '').trim().toLowerCase();
        const email = String(row[3] || '').trim();
        if (name && email) emailByManagerNameLower[name] = email;
      });
    }

    return { byRmNameLower: byRmNameLower, emailByManagerNameLower: emailByManagerNameLower };
  }, 'loadRmHierarchyAndEmails_');
}

// Two leadership addresses that go on every overnight/summary issue email
// regardless of region or RM — not derived from the hierarchy data at all,
// just a fixed business requirement layered on top of it.
const ALWAYS_CC_EMAILS_ = ['ashish.kukreja@homesfy.in', 'saurabh.mishra@homesfy.in'];

/**
 * For a set of RM names (whoever had overnight activity in one region),
 * returns { to: [emails], cc: [emails], resolvedCount, totalCount } —
 * deduped so a CH shared by 10 flagged RMs appears once, not 10 times.
 *
 * To: the RM's Team Lead (A1) ONLY — never RH/CH/Other — EXCEPT when the
 * RM has no Team Lead at all (reports straight to RH/CH/Admin), in which
 * case that direct manager becomes "to" instead, so there's still a real
 * action-owner named rather than nobody.
 *
 * Cc: whichever of RH/CH this chain actually has (mutually exclusive per
 * person in this data — a chain never has both) — RH is the compulsory
 * one per the business rule, CH is the optional one, but since a chain can
 * only ever surface one or the other here, both are simply cc'd whenever
 * present; there's no case where CH shows up without RH being considered
 * first. Plus ALWAYS_CC_EMAILS_ on every single email, unconditionally.
 */
function resolveRecipientsForRms_(ss, rmNames) {
  const data = loadRmHierarchyAndEmails_(ss);
  const toSet = new Set();
  const ccSet = new Set();
  let resolvedCount = 0;

  rmNames.forEach(function (rmName) {
    const chain = data.byRmNameLower[String(rmName || '').trim().toLowerCase()];
    if (!chain || chain.excluded) return;
    // "To" is the TL only; RH is the fallback ONLY when there's no TL at
    // all (never as a secondary alongside a TL — that's what Cc is for).
    const primaryName = chain.tl || chain.rh || chain.ch || chain.other || '';
    let gotOne = false;
    if (primaryName) {
      const email = data.emailByManagerNameLower[primaryName.toLowerCase()];
      if (email) { toSet.add(email); gotOne = true; }
    }
    [chain.rh, chain.ch].forEach(function (name) {
      if (!name) return;
      const email = data.emailByManagerNameLower[name.toLowerCase()];
      if (email) { ccSet.add(email); gotOne = true; }
    });
    if (gotOne) resolvedCount++;
  });

  ALWAYS_CC_EMAILS_.forEach(function (e) { ccSet.add(e); });
  // A manager already in "to" shouldn't also clutter the "cc" line.
  toSet.forEach(function (e) { ccSet.delete(e); });

  return { to: Array.from(toSet), cc: Array.from(ccSet), resolvedCount: resolvedCount, totalCount: rmNames.length };
}

// ---- One-time setup — run this once from the editor (also called by
// setupOvernightEmailer, so a single run of that sets everything up) ----
function setupRmHierarchy() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ensureRmHierarchySheet_(ss);
  ensureManagerDirectorySheet_(ss);
  Logger.log(
    'RM_Hierarchy + Manager_Directory ready. Most managers already have an email auto-filled from ' +
    'Book7.xlsx (see Manager_Directory\'s email_source column: "Book7 auto-match" vs "manual") — check ' +
    'the ones still blank and fill those in by hand. Until a manager has an email either way, ' +
    'OvernightEmailer falls back to the legacy Region_Recipients entry for that region.'
  );
}

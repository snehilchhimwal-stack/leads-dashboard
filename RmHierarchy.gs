/**
 * RM Hierarchy — resolves each RM's real manager chain (A1/Team Lead, TM,
 * RH, CH) from the same official HR export Book7.xlsx that
 * RmHierarchy.private.gs's employee-email table already comes from, so
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
 * WHY THIS IS PRE-RESOLVED, NOT RAW: Book7's own export is POSITIONAL, not
 * per-role — its "A1 - 1/S2" / "A1 - 2" / "RH" / "CH/CL" columns hold
 * whoever the next real manager up the chain happens to be, landing in
 * whichever column matches how many hops that specific person's chain has
 * (e.g. an S1 reporting straight to a TM with no A1 in between has that TM
 * in the RH-position column, not because the TM IS an RH, but because
 * that's the next column over). Each row below was built by resolving
 * every filled slot against THAT PERSON'S OWN role (Book7 tags everyone as
 * S1/A1/TM/RH/Cluster Head/City Lead/Commercial Head/etc.) rather than
 * trusting column position — the only reliable way to build clean tl/tm/
 * rh/ch columns from this export. TM is a real tier Book7 has that the
 * OLD org-chart source this file used to be built from did not: it sits
 * above A1 but below RH — some regions route S1s straight to a TM with no
 * A1 at all, others keep a real A1 with a TM one level above THEM.
 *
 * EMAIL ADDRESSES: EMPLOYEE_EMAIL_BY_NAME_RAW_ (RmHierarchy.private.gs) is
 * sourced from this SAME Book7.xlsx export, matched in by NAME
 * (case/whitespace-normalized, see normPersonName_) since Book7 and this
 * table share no common ID column, only name text — but since both now
 * come from the identical source rows (not two independently-exported
 * files with different spellings, like the old org-chart source had),
 * name matching here is far more reliable than it used to be.
 * setupRmHierarchy() writes a "Manager_Directory" sheet — one row per
 * unique manager name — with its Email column PRE-FILLED wherever a name
 * match was found; still blank for the handful that weren't. A human can
 * always overwrite any auto-filled email — see point 3 below for what
 * survives a later rebuild. Until a manager has an email (auto-filled or
 * hand-entered), resolveRecipientEmailsForRegion_ in OvernightEmailer.gs
 * finds no emails to route to for RMs under them and falls back to the
 * legacy Region_Recipients entry for that region, so today's automation
 * keeps working unchanged for anyone still uncovered.
 *
 * ============================== SETUP (one-time) ==============================
 *   1. Same Apps Script project as MovementTracker.gs and OvernightEmailer.gs.
 *      Add a new file, paste this whole thing in.
 *   2. Run setupRmHierarchy once (or it runs automatically as part of
 *      setupOvernightEmailer). This creates two sheets:
 *        - RM_Hierarchy: one row per person, showing the resolved
 *          TL(A1)/TM/RH/CH columns. An "Excluded" checkbox is included for
 *          hand-flagging any row that shouldn't route (nothing here is
 *          auto-detected as a dummy/test account — Book7 is a real HR
 *          export, not the messy org-chart source this used to read).
 *          A "Note" column is blank unless a person genuinely has no
 *          manager on file at all (fill in by hand if you want that
 *          chain covered).
 *        - Manager_Directory: one row per unique manager name (deduped
 *          across every TL/TM/RH/CH they show up as) with the regions
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

// One row per person: [team, role, name, tl, tm, rh, ch] — ALREADY
// resolved (see the file header above for why raw Book7 columns can't be
// read positionally). Source: Book7.xlsx, same export
// RmHierarchy.private.gs's EMPLOYEE_EMAIL_BY_NAME_RAW_ comes from. Every
// person in the HR roster is included, not just Sales — a Finance/HR/
// Marketing person simply never appears as anyone's "RM" on a real lead,
// so their row is inert; including them costs nothing and maximizes the
// chance any real RM name resolves.
const RM_HIERARCHY_RAW_ = [
  ['Leadership','Commercial Head','Neha Mishra','','','',''],
  // Added as Bangalore/Hyderabad's CH per explicit request — no row for
  // Mukesh Mishra in the original org-chart export, so added here
  // directly rather than relying on the auto-match.
  ['Leadership','Cluster Head','Mukesh Mishra','','','',''],
  ['Navi Mumbai','Cluster Head','Vidya Jadhav','','','',''],
  ['Thane','Cluster Head','Bipin More','','','',''],
  ['Central','Cluster Head','Sanjyota Bhosale','','','',''],
  ['Thane','RH','Swapnil Gowalkar','','','','Bipin More'],
  ['Navi Mumbai','TM','Sampada Pawar','','','','Vidya Jadhav'],
  ['Navi Mumbai','A1','Avinash Kumar','','','','Vidya Jadhav'],
  ['Central','RH','Rajkumar Ombase','','','','Sanjyota Bhosale'],
  ['Bangalore','A1','Chaithanya M','','','Romen Singh','Mukesh Mishra'],
  ['Bangalore','A1','Krishna Murthy','','','','Mukesh Mishra'],
  // Added from Book7's own export (she was never included in the
  // original hierarchy build, despite having a full chain there:
  // TL Chaithanya M, RH Romen Singh, CH Mukesh Mishra) — real production
  // symptom: her overnight leads got no automated email, with an
  // "unresolved, not in RM_Hierarchy" ops alert instead.
  ['Bangalore','S1','Neelam Singh','Chaithanya M','','Romen Singh',''],
  ['Central','A1','Sachin Rana','','','Rajkumar Ombase','Sanjyota Bhosale'],
  ['Central','A1','Mukesh Yadav','','','Rajkumar Ombase','Sanjyota Bhosale'],
  ['Central','A1','Akash A Ugale','','','','Sanjyota Bhosale'],
  ['Central','S1','Prajwal Shetty','Akash A Ugale','','','Sanjyota Bhosale'],
  ['Navi Mumbai','S1','Ashish Kadam','Avinash Kumar','','','Vidya Jadhav'],
  ['Pune','City Lead','Sourabh Sareen','','','',''],
  ['Bangalore','S1','Sangam S','Krishna Murthy','','',''],
  ['Bangalore','S1','Chandana N R','','','Romen Singh',''],
  ['Pune','RH','Sachindra Wadane','','','','Sourabh Sareen'],
  ['Pune','A1','Nishant Anand','','','Sachindra Wadane','Sourabh Sareen'],
  ['Pune','S1','Rahul Panherkar','','','Sachindra Wadane','Sourabh Sareen'],
  ['Pune','TM','Ayaz Bagwan','','','','Sourabh Sareen'],
  ['Pune','S1','Siddhesh Bhagwat','','','Sachindra Wadane','Sourabh Sareen'],
  ['Pune','S1','Shailesh Tiwari','','','Sachindra wadane','Sourabh Sareen'],
  ['Harbour','A1','Yash Sharma','','','','Sanjyota Bhosale'],
  ['Navi Mumbai','S1','Shahnavaz Shaikh','Avinash Kumar','','','Vidya Jadhav'],
  ['Pune','S1','Nagesh Maharnavar','','Ayaz Bagwan','','Sourabh Sareen'],
  ['Navi Mumbai','S1','Shubham Buchade','Avinash Kumar','','','Vidya Jadhav'],
  ['Thane','A1','Amit Upadhyay','','','','Bipin More'],
  ['Bangalore','S1','Manoj M','Rahan Khan','','Romen Singh',''],
  ['Pune','TM','Rahul Poudel','','','','Sourabh Sareen'],
  ['Pune','A1','Prathamesh A Pande','','Rahul Poudel','','Sourabh Sareen'],
  ['Pune','A1','Nayan Pabale','','Rahul Poudel','','Sourabh Sareen'],
  ['Thane','S1','Mamtaben Sosa','Amit Upadhyay','','','Bipin More'],
  ['Pune','S1','Santosh Khandare','','','Sachindra Wadane','Sourabh Sareen'],
  ['Pune','S1','Swapnil Waghmode','Nishant Anand','','Sachindra Wadane','Sourabh Sareen'],
  ['Bangalore','S1','Anurag G Singh','Krishna Murthy','','',''],
  ['Central','S1','Khushal Soni','Sachin Rana','','Rajkumar Ombase','Sanjyota Bhosale'],
  ['Pune','A1','Omkar Ghate','','Ayaz Bagwan','','Sourabh Sareen'],
  ['Pune','S1','Akshay More','Prathamesh A Pande','Rahul Poudel','','Sourabh Sareen'],
  ['Thane','S1','Avinash Khare','Ganesh Saroj','','Swapnil Gowalkar','Bipin More'],
  ['Hyderabad','S1','Parusharothu Vinay Varma','Vemula Ajay','','',''],
  ['Navi Mumbai','S1','Rutuja Daule','','Sampada Pawar','','Vidya Jadhav'],
  ['Navi Mumbai','S1','Chandrakant Bhagat','','Sampada Pawar','','Vidya Jadhav'],
  ['Navi Mumbai','S1','Prachi Chouhan','','Sampada Pawar','','Vidya Jadhav'],
  ['Pune','A1','Firoj Shaikh','','Ayaz Bagwan','','Sourabh Sareen'],
  ['Pune','S1','Pravin Kharat','','Ayaz Bagwan','','Sourabh Sareen'],
  ['Thane','S1','Saurabh M S','Niraj Patil','','Swapnil Gowalkar','Bipin More'],
  ['Thane','A1','Niraj Patil','','','Swapnil Gowalkar','Bipin More'],
  ['Western','S1','Pratapkumar Yadav','','Minas Patel','','Rahul Gandhi'],
  ['Western','S1','Sonam Dubey','','Minas Patel','','Rahul Gandhi'],
  ['Hyderabad','A1','Vemula Ajay','','','','Mukesh Mishra'],
  ['Western','S1','Saravash Upadhyay','','Minas Patel','','Rahul Gandhi'],
  ['Harbour','S1','Nitin Devariya','Yash Sharma','','','Sanjyota Bhosale'],
  ['Bangalore','S1','Sahil Kumar S','Chaithanya M','','Romen Singh',''],
  ['Western','S1','Arbaz Patel','Prathmesh S Pandey','','','Rahul Gandhi'],
  ['Western','Cluster Head','Rahul Gandhi','','','',''],
  ['Pune','S1','Nikhil Sarwade','','','Sachindra Wadane','Sourabh Sareen'],
  ['Western','S1','Lalita Yadav','Prathmesh S Pandey','','','Rahul Gandhi'],
  ['Thane','S1','Mohd Adnan Malik','Amit Upadhyay','','','Bipin More'],
  ['Pune','S1','Mahesh Mahore','','','Sachindra Wadane','Sourabh Sareen'],
  ['Thane','S1','Akash Gaikwad','Niraj Patil','','Swapnil Gowalkar','Bipin More'],
  ['Central','S1','Shubham Raj','Sachin Rana','','Rajkumar Ombase','Sanjyota Bhosale'],
  ['HNI','S1','Sahil Gupta','Pritesh Shankhat','','','Abhhijjit Gandhii'],
  ['Thane','S1','Mohit Manwani','','Sanket Yadav','','Bipin More'],
  ['Thane','A1','Ganesh Saroj','','','Swapnil Gowalkar','Bipin More'],
  ['Pune','S1','Nagmma Mujnayak','Firoj Shaikh','','','Sourabh Sareen'],
  ['Hyderabad','S1','Maagathoti Adilakshmi','Vemula Ajay','','',''],
  ['Navi Mumbai','S1','Jayesh Parab','Avinash Kumar','','','Vidya Jadhav'],
  ['Bangalore','S1','Praveen R','Krishna Murthy','','',''],
  ['Western','A1','Prathmesh S Pandey','','','','Rahul Gandhi'],
  ['Central','S1','Shital Bhagwane','Mukesh Yadav','','Rajkumar Ombase','Sanjyota Bhosale'],
  ['HNI','A1','Pritesh Shankhat','','','','Abhhijjit Gandhii'],
  ['Western','S1','Vijay Yadav','Prathmesh S Pandey','','','Rahul Gandhi'],
  ['Western','S1','Lovkesh Pandey','Prathmesh S Pandey','','','Rahul Gandhi'],
  ['Bangalore','S1','Mhd Haseebulla','Krishna Murthy','','',''],
  ['Western','S1','Kundan Singh','Prathmesh S Pandey','','','Rahul Gandhi'],
  ['Hyderabad','S1','Vadlapudi Divya','Vemula Ajay','','',''],
  ['Thane','S1','Avinash Das','Ganesh Saroj','','Swapnil Gowalkar','Bipin More'],
  ['Central','S1','Purvesh Ugawekar','Akash A Ugale','','','Sanjyota Bhosale'],
  ['Harbour','S1','Dhiraj Chhoda','Yash Sharma','','','Sanjyota Bhosale'],
  ['Central','S1','Mustakim Sayyad','Akash A Ugale','','','Sanjyota Bhosale'],
  ['Pune','S1','Somanath Sangle','Nishant Anand','','Sachindra Wadane','Sourabh Sareen'],
  ['Thane','S1','Divya Rohela','Ganesh Saroj','','Swapnil Gowalkar','Bipin More'],
  ['Pune','S1','Arbaj Shaikh','','Rahul Poudel','','Sourabh Sareen'],
  ['Thane','S1','Kamlesh Tawale','','','Swapnil Gowalkar','Bipin More'],
  ['Thane','S1','Arbaaz Ansari','Amit Upadhyay','','','Bipin More'],
  ['Pune','S1','Ravi Pandey','Nishant Anand','','Sachindra Wadane','Sourabh Sareen'],
  ['Pune','S1','Vaibhav Bhadkumbe','','Ayaz Bagwan','','Sourabh Sareen'],
  ['Central','S1','Kishan Patel','Akash A Ugale','','','Sanjyota Bhosale'],
  ['Navi Mumbai','S1','Joshi Dhairya','','','','Vidya Jadhav'],
  // ch added — his own row was missing the Mukesh Mishra reference his
  // own Bangalore A1 subordinates (Chaithanya M, Krishna Murthy,
  // Mainuddin T, Rahan Khan) already carry, which meant a lead assigned
  // directly to Romen Singh himself fell to "unresolved" instead of
  // properly routing further up like everyone below him does.
  ['Bangalore','RH','Romen Singh','','','','Mukesh Mishra'],
  ['Bangalore','S1','Sippal Khora','Chaithanya M','','Romen Singh',''],
  ['Harbour','S1','Aakash Dhole','Yash Sharma','','','Sanjyota Bhosale'],
  ['Western','S1','Yash Kandhare','Prathmesh S Pandey','','','Rahul Gandhi'],
  ['Bangalore','S1','Suman Das','Mainuddin T','','Romen Singh',''],
  ['Bangalore','S1','Zain Ahmed','Chaithanya M','','Romen Singh',''],
  ['Pune','S1','Souvik Biswas','','','Sachindra Wadane','Sourabh Sareen'],
  ['Central','S1','Mihir Jivani','Sachin Rana','','Rajkumar Ombase','Sanjyota Bhosale'],
  ['Bangalore','S1','Divakar V','Chaithanya M','','Romen Singh',''],
  ['Bangalore','A1','Mainuddin T','','','Romen Singh','Mukesh Mishra'],
  ['Western','S1','Saurabh Pandey','Prathmesh S Pandey','','','Rahul Gandhi'],
  ['Pune','S1','Vishwanath Zalake','Firoj Shaikh','','','Sourabh Sareen'],
  ['Pune','S1','Ritik Minekar','Nishant Anand','','Sachindra Wadane','Sourabh Sareen'],
  ['Central','S1','Sumeet Pal','Akash A Ugale','','','Sanjyota Bhosale'],
  ['Central','S1','Gurmohit Singh Sandhu','Sachin Rana','','Rajkumar Ombase','Sanjyota Bhosale'],
  ['Bangalore','S1','Mahesh V','Rahan Khan','','Romen Singh',''],
  ['Harbour','S1','Bisma Shah','Yash Sharma','','','Sanjyota Bhosale'],
  ['Bangalore','S1','Abdur Rahim','Mainuddin T','','Romen Singh',''],
  ['Pune','S1','Nagnath Dhotre','Nishant Anand','','Sachindra Wadane','Sourabh Sareen'],
  ['Pune','S1','Aditya Tripathi','Nayan Pabale','Rahul Poudel','','Sourabh Sareen'],
  ['Pune','S1','Chaitali Patil','Nishant Anand','','Sachindra Wadane','Sourabh Sareen'],
  ['Thane','S1','Sajid Mulani','Amit Upadhyay','','','Bipin More'],
  ['Western','S1','Eknidhi Chabra','','Minas Patel','','Rahul Gandhi'],
  ['Western','S1','Gajanan Jadhav','','Minas Patel','','Rahul Gandhi'],
  ['Western','TM','Minas Patel','','','','Rahul Gandhi'],
  ['Central','S1','Zeya Shaikh','Mukesh Yadav','','Rajkumar Ombase','Sanjyota Bhosale'],
  ['Thane','S1','Vishal Chavan','Ganesh Saroj','','Swapnil Gowalkar','Bipin More'],
  ['Navi Mumbai','S1','Mohd Yaqub Nawab','','Sampada Pawar','','Vidya Jadhav'],
  ['Pune','S1','Gaurav Gunjal','Nayan Pabale','Rahul Poudel','','Sourabh Sareen'],
  ['Pune','S1','Arpita Varte','','Ayaz Bagwan','','Sourabh Sareen'],
  ['Thane','S1','Ranjana Dubey','Niraj Patil','','Swapnil Gowalkar','Bipin More'],
  ['Thane','S1','Aman Gupta','Amit Upadhyay','','','Bipin More'],
  ['Pune','S1','Pramod Ghaytadak','','Ayaz Bagwan','','Sourabh Sareen'],
  ['Pune','S1','Gouttam Aicha','Nishant Anand','','Sachindra Wadane','Sourabh Sareen'],
  ['Thane','S1','Sagar Mahamuni','','','Swapnil Gowalkar','Bipin More'],
  ['Central','S1','Karan Shinde','Mukesh Yadav','','Rajkumar Ombase','Sanjyota Bhosale'],
  ['HNI','S1','Yashodeep Kubavat','','','','Abhhijjit Gandhii'],
  ['Western','S1','Riya Yadav','','Minas Patel','','Rahul Gandhi'],
  ['Central','S1','Mayuresh Chavan','Mukesh Yadav','','Rajkumar Ombase','Sanjyota Bhosale'],
  ['Central','S1','Vivek Yadav','Mukesh Yadav','','Rajkumar Ombase','Sanjyota Bhosale'],
  ['Hyderabad','S1','Peddapally Veera Shivaji','Vemula Ajay','','',''],
  ['Thane','S1','Hitesh Jaiswar','Amit Upadhyay','','','Bipin More'],
  ['Navi Mumbai','S1','Kartik Shirsat','','Sampada Pawar','','Vidya Jadhav'],
  ['Navi Mumbai','S1','Rinky Bidare','','Sampada Pawar','','Vidya Jadhav'],
  ['Thane','S1','Sunny Saini','Amit Upadhyay','','','Bipin More'],
  ['Thane','S1','Kishan Lohar','Amit Upadhyay','','','Bipin More'],
  ['Navi Mumbai','S1','Suman Pujari','Avinash Kumar','','','Vidya Jadhav'],
  ['Navi Mumbai','S1','Tejal Nikam','Avinash Kumar','','','Vidya Jadhav'],
  ['Hyderabad','S1','G Anand Kumar','Vemula Ajay','','',''],
  // Alias row, confirmed by hand: the leads sheet's RM column sometimes
  // has just "G Kumar" for this same person (a real "no recipient"
  // production case) — exact-match name lookup needs a literal row for
  // each spelling actually seen, same chain as his real row above.
  ['Hyderabad','S1','G Kumar','Vemula Ajay','','',''],
  ['Pune','S1','Aadesh Narwade','Prathamesh A Pande','Rahul Poudel','','Sourabh Sareen'],
  ['Pune','S1','Soyeb Akhtar','Firoj Shaikh','','','Sourabh Sareen'],
  ['Harbour','S1','Manan Bhatt','Yash Sharma','','','Sanjyota Bhosale'],
  ['Western','S1','Vijay Katheriya','','MInas Patel','','Rahul Gandhi'],
  ['Bangalore','S1','Rahul Singh','Krishna murthy','','',''],
  ['Pune','S1','Aabid Khan','Firoj Shaikh','','','Sourabh Sareen'],
  ['HNI','S1','Mohammed Rafiq Khan','Pritesh Shankhat','','','Abhhijjit Gandhii'],
  // Alias row, confirmed by hand against Book7 (email mohammed.khan@homesfy.in
  // matches the row above exactly): the leads sheet's RM column sometimes
  // has just "Mohammed Khan" for this same person -- a real "no
  // recipient" production case (region mapped to SoBo, since HNI is
  // SoBo's own team label in REGION_GROUP_MAP_/OvernightEmailer.gs).
  ['HNI','S1','Mohammed Khan','Pritesh Shankhat','','','Abhhijjit Gandhii'],
  ['HNI','S1','Adil Shaikh','Pritesh Shankhat','','','Abhhijjit Gandhii'],
  ['Central','S1','Rohit Gupta','Kumar Babu','','Rajkumar Ombase','Sanjyota Bhosale'],
  ['Central','A1','Kumar Babu','','','Rajkumar Ombase','Sanjyota Bhosale'],
  ['Pune','S1','Rahul Raj','Nayan Pabale','Rahul Poudel','','Sourabh Sareen'],
  ['Central','S1','Fakrealam Ansari','Kumar Babu','','Rajkumar Ombase','Sanjyota Bhosale'],
  ['Pune','S1','Sahil Gote','','','Sachindra Wadane','Sourabh Sareen'],
  ['Pune','A1','Rohit Rathod','','','Sachindra Wadane','Sourabh Sareen'],
  ['Pune','S1','Yash Awade','Prathamesh A Pande','Rahul Poudel','','Sourabh Sareen'],
  ['Pune','S1','Israr Khan','Firoj Shaikh','','','Sourabh Sareen'],
  ['Bangalore','S1','Md Muzamil','Mainuddin T','','Romen Singh',''],
  ['Bangalore','S1','Mohammed Hidayathulla','Chaithanya M','','Romen Singh',''],
  ['Navi Mumbai','S1','Chandni Khatoon','','','','Vidya Jadhav'],
  ['Pune','S1','Rajdeep Jalan','Rohit Rathod','','Sachindra Wadane','Sourabh Sareen'],
  ['Pune','S1','Pranav Deshmukh','Prathamesh A Pande','Rahul Poudel','','Sourabh Sareen'],
  ['Navi Mumbai','S1','Jitendra Phulwaria','','','','Vidya Jadhav'],
  ['Central','S1','Sneha Upadhyay','Kumar Babu','','Rajkumar Ombase','Sanjyota Bhosale'],
  ['Thane','S1','Jay Patil','Niraj Patil','','Swapnil Gowalkar','Bipin More'],
  ['Pune','S1','Wasim Shaikh','Omkar Ghate','Ayaz Bagwan','','Sourabh Sareen'],
  ['HNI','Cluster Head','Abhhijjit Gandhii','','','',''],
  ['Navi Mumbai','S1','Jyoti Ram','Avinash Kumar','','','Vidya Jadhav'],
  ['Central','S1','Sanjay Gupta','Kumar Babu','','Rajkumar Ombase','Sanjyota Bhosale'],
  ['Bangalore','A1','Rahan Khan','','','Romen Singh','Mukesh Mishra'],
  ['Central','S1','Saurabh Pacharne','Kumar Babu','','Rajkumar Ombase','Sanjyota Bhosale'],
  ['Navi Mumbai','S1','Amit Rathod','Avinash Kumar','','','Vidya Jadhav'],
  ['Pune','S1','Ramesh Kudale','Omkar Ghate','Ayaz Bagwan','','Sourabh Sareen'],
  ['HNI','S1','Hetal Gohil','Pritesh Shankhat','','','Abhhijjit Gandhii'],
  ['HNI','S1','Jyoti Sharma','','','','Abhhijjit Gandhii'],
  ['HNI','S1','Shivani Ilahabadi','Pritesh Shankhat','','','Abhhijjit Gandhii'],
  ['Pune','S1','Tarush Dhingra','','Rahul Poudel','','Sourabh Sareen'],
  ['Pune','S1','Akash Jogdand','Rohit Rathod','','Sachindra Wadane','Sourabh Sareen'],
  ['Pune','S1','Vivek Solanke','Nishant Anand','','Sachindra Wadane','Sourabh Sareen'],
  ['HNI','S1','Mohd Faizan Shaikh','','','','Abhhijjit Gandhii'],
  // Alias — leads sheet has him as the shorter "Mohd Shaikh" (no
  // "Faizan"); do not go with any role or position in name, do not
  // consider — same name-variant pattern as G Kumar/Mohammed Khan
  // earlier. Real production symptom: "unresolved, not in RM_Hierarchy"
  // ops alert for SoBo (HNI rolls up into the SoBo main-region bucket).
  ['HNI','S1','Mohd Shaikh','','','','Abhhijjit Gandhii'],
  ['Harbour','S1','Atharva Belose','Yash Sharma','','','Sanjyota Bhosale'],
  // Alias — leads sheet has his middle initial: "Atharva P Belose". Real
  // production symptom: "unresolved, not in RM_Hierarchy" ops alert for
  // Harbour.
  ['Harbour','S1','Atharva P Belose','Yash Sharma','','','Sanjyota Bhosale'],
  ['Hyderabad','S1','Nikhil Goud','Vemula Ajay','','',''],
  ['Thane','TM','Sanket Yadav','','','','Bipin More'],
  ['Pune','S1','Abhikesh Kumar','','Rahul Poudel','','Sourabh Sareen'],
  ['Pune','S1','Krish Sinha','Nayan Pabale','Rahul Poudel','','Sourabh Sareen'],
  ['Pune','S1','Akshay Dawle','Nayan Pabale','Rahul Poudel','','Sourabh Sareen'],
  ['Thane','S1','Roshan Pandey','','Sanket Yadav','','Bipin More'],
  ['Navi Mumbai','S1','Harshith S','','Sampada Pawar','','Vidya Jadhav'],
  ['Pune','S1','Adinath Munde','','Rahul Poudel','','Sourabh Sareen'],
  ['Pune','S1','Buddhabhushan Wakode','','Rahul Poudel','','Sourabh Sareen'],
  ['Commercial','A1','Aarya Sadanam','','','','Neha Mishra'],
  ['Bangalore','S1','Vijay Kumar E','Rahan Khan','','Romen Singh',''],
  ['Central','S1','Farid Shaikh','Akash A Ugale','','','Sanjyota Bhosale'],
  ['Thane','S1','Riyan Jamadar','','','','Bipin More'],
  ['Thane','S1','Rahul Chauhan','Ganesh Saroj','','Swapnil Gowalkar','Bipin More'],
  ['Central','S1','Shreyang Chudasama','Akash A Ugale','','','Sanjyota Bhosale'],
  ['Central','S1','Shresth Bhuwania','Akash A Ugale','','','Sanjyota Bhosale'],
  ['Bangalore','S1','Kavya B R','','','Romen Singh',''],
  ['Pune','S1','Priyangshu Dey','','Ayaz Bagwan','','Sourabh Sareen'],
  ['Pune','S1','Vijay Kshirsagar','','Rahul Poudel','','Sourabh Sareen'],
  // Whole "Sourcing - Pune" team corrected/added from Book7 directly
  // (row-by-row lookup, not the pre-resolved export) after 4 of its 6
  // people showed up as "no recipient" — Yash Kalal (their actual
  // manager, role 'TM' here even though Book7 literally labels him
  // 'S2'/"Supervisor": functionally identical to Sampada
  // Pawar/Minas Patel/Sanket Yadav — reports directly to a CH with no
  // A1 layer, with S1/S3 reports under him) was missing entirely, which
  // also means Darshana Javeri's row below was WRONG (went straight to
  // Sourabh Sareen with no tm at all) until this fix.
  ['Sourcing - Pune','TM','Yash Kalal','','','','Sourabh Sareen'],
  ['Sourcing - Pune','S3','Nikhil Jadhav','','Yash Kalal','','Sourabh Sareen'],
  ['Sourcing - Pune','S3','Dnyaneshwari Pawar','','Yash Kalal','','Sourabh Sareen'],
  ['Sourcing - Pune','S3','Anagha Sangole','','Yash Kalal','','Sourabh Sareen'],
  ['Sourcing - Pune','S3','Vidisha Kakade','','Yash Kalal','','Sourabh Sareen'],
  ['Sourcing - Pune','S3','Darshana Javeri','','Yash Kalal','','Sourabh Sareen'],
  ['Thane','S1','Pawan Motwani','','','Swapnil Gowalkar','Bipin More'],

  // Whole "Loan" team added from Book7 directly — this is one of the 11
  // configured regions (REGION_GROUP_MAP_, OvernightEmailer.gs) but had
  // ZERO rows here before this, found via a full Book7-vs-RM_HIERARCHY_RAW_
  // diff (315 Book7 people vs 212 rows here) run specifically to catch
  // every gap of Neelam Singh's kind, not just the ones that happened to
  // surface as a real "no recipient" alert yet. Every OTHER Book7 person
  // with no row here (Marketing/Technology/Finance/HR/Customer Experience/
  // Post Sales/Magnet/Sales Trainer/corporate Leadership) is a genuinely
  // different business unit or corporate function — never assigned as an
  // RM on a first-sale Google lead, so deliberately NOT added; adding them
  // would just be noise this table was never meant to carry.
  // Mayur Panjari is Loan's top (Book7 P&L = Mukesh Mishra directly,
  // nothing else above him within Loan) — same structural position as
  // Sourabh Sareen (Pune City Lead), so given the same role label for the
  // same reason (isTopOfOrgRole_ — RmHierarchy.gs).
  ['Loan','City Lead','Mayur Panjari','','','',''],
  ['Loan','A1','Zahid Shaikh','','','Mayur Panjari',''],
  ['Loan','S1','Swapnil B Bhosale','','','Mayur Panjari',''],
  ['Loan','S1','Yogesh Choudhari','','','Mayur Panjari',''],
  ['Loan','S1','Angad Yadav','','','Mayur Panjari',''],
  ['Loan','S1','Akshay Kakade','','','Mayur Panjari',''],
  ['Loan','S1','Aditya Gera','','','Mayur Panjari',''],
  ['Loan','S1','Husen Shaikh','','','Mayur Panjari',''],
  ['Loan','S1','Narayan Dhimar','','','Mayur Panjari',''],
  ['Loan','S1','Krishna Nayak','','','Mayur Panjari',''],
  ['Loan','S1','Gayatri Kukade','','','Mayur Panjari',''],
  ['Loan','S1','Mohammad Azaz Izhar Ansari','','','Mayur Panjari',''],
  ['Loan','S1','Sachin Kadam','Zahid Shaikh','','Mayur Panjari',''],
  ['Loan','S1','Kanchan Hatipkar','Zahid Shaikh','','Mayur Panjari',''],
  ['Loan','S1','Divya Dalvi','Zahid Shaikh','','Mayur Panjari',''],
  ['Loan','S1','Priyanka Shede','Zahid Shaikh','','Mayur Panjari',''],
  ['Loan','S1','Mohd Ali Khan','Zahid Shaikh','','Mayur Panjari',''],
  ['Loan','S1','Siddhi Kate','Zahid Shaikh','','Mayur Panjari',''],
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


/**
 * Maps RM_HIERARCHY_RAW_ into one row object per person. Unlike the old
 * org-chart source, this table is ALREADY resolved (see the file header's
 * "WHY THIS IS PRE-RESOLVED" section) — no chain-walking needed here, just
 * attach each person's email and default the manual-only fields (excluded/
 * note start blank; a human fills these in directly in the sheet, and
 * rebuildRmHierarchy preserves them across a refresh). Returns an array of
 * row objects; does not touch any sheet (pure function, easy to test in
 * isolation).
 */
function resolveRmHierarchy_() {
  return RM_HIERARCHY_RAW_.map(function (r) {
    const team = r[0], role = r[1], name = r[2], tl = r[3], tm = r[4], rh = r[5], ch = r[6];
    return {
      team: team, role: role, name: name,
      tl: tl, tm: tm, rh: rh, ch: ch,
      excluded: false,
      note: (tl || tm || rh || ch) ? '' : 'No manager on file for this person.',
      email: lookupEmployeeEmail_(name),
    };
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
  const headers = ['team', 'role', 'name', 'tl', 'tm', 'rh', 'ch', 'excluded', 'note', 'email'];
  const rows = resolved.map(function (p) {
    return [p.team, p.role, p.name, p.tl, p.tm, p.rh, p.ch, p.excluded, p.note, p.email];
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
  withRetry_(function () { sheet.getRange(2, 8, rows.length, 1).insertCheckboxes(); }, 'insert RM_Hierarchy checkboxes');
  return sheet;
}

/**
 * Rebuilds RM_Hierarchy from the current RM_HIERARCHY_RAW_ table (e.g.
 * after pasting in a fresh export), while PRESERVING every manual edit a
 * human made in the existing sheet — Excluded checkbox and Note, matched
 * by person name (case-insensitive). People no longer in the source table
 * are dropped.
 */
function rebuildRmHierarchy() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const headers = ['team', 'role', 'name', 'tl', 'tm', 'rh', 'ch', 'excluded', 'note', 'email'];

  const priorByName = {};
  withRetry_(function () {
    const sheet = ss.getSheetByName(RM_HIERARCHY_SHEET_);
    if (!sheet) return;
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return;
    // An older sheet (pre-HR-source layout) has more/fewer columns — read
    // whatever's there rather than assuming headers.length, so a missing
    // column just comes back undefined/blank instead of erroring. Anyone
    // rebuilding from that old layout loses their prior excluded/note/email
    // (the column positions genuinely changed), same one-time cost as any
    // schema change — not something a name-matched merge can paper over.
    const lastCol = Math.max(sheet.getLastColumn(), headers.length);
    sheet.getRange(2, 1, lastRow - 1, lastCol).getValues().forEach(function (row) {
      const name = String(row[2] || '').trim().toLowerCase();
      if (!name) return;
      priorByName[name] = { excluded: row[7], note: String(row[8] || ''), email: String(row[9] || '') };
    });
  }, 'read existing RM_Hierarchy before rebuild');

  const resolved = resolveRmHierarchy_();
  const rows = resolved.map(function (p) {
    const prior = priorByName[p.name.trim().toLowerCase()];
    // A human-entered note/email survives untouched; only fall back to
    // this script's own guess (or the Book7 auto-lookup, for email) when
    // there's no prior row for this person.
    const excluded = prior ? prior.excluded : p.excluded;
    const note = prior && prior.note ? prior.note : p.note;
    const email = prior && prior.email ? prior.email : p.email;
    return [p.team, p.role, p.name, p.tl, p.tm, p.rh, p.ch, excluded, note, email];
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
  withRetry_(function () { sheet.getRange(2, 8, rows.length, 1).insertCheckboxes(); }, 'insert RM_Hierarchy checkboxes');

  ensureManagerDirectorySheetInternal_(ss, true);
  Logger.log('RM_Hierarchy rebuilt: ' + rows.length + ' people. Manager_Directory refreshed (emails preserved).');
}

// ONE-OFF DIAGNOSTIC — read-only, lists every row currently checked
// Excluded in RM_Hierarchy. resolveRmHierarchy_() itself always generates
// excluded: false (see its own comment) — rebuildRmHierarchy only ever
// preserves whatever was ALREADY in the sheet's Excluded column across a
// rebuild, by design, so it can carry forward a genuine manual choice.
// A row reading Excluded=true that nobody remembers checking is most
// likely a stale carry-over from the OLD org-chart-based hierarchy this
// file replaced, which used to auto-flag "dummy" rows this way — that
// mechanism doesn't exist in the current HR-based system at all, so
// there's no code path left that would set this to true on its own.
// Run this to see the full list before deciding whether to clear any of
// them (see clearAllRmHierarchyExclusionsNow below).
function listExcludedRmsNow() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(RM_HIERARCHY_SHEET_);
  if (!sheet) { Logger.log('RM_Hierarchy sheet not found.'); return; }
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) { Logger.log('RM_Hierarchy is empty.'); return; }

  const rows = withRetry_(function () { return sheet.getRange(2, 1, lastRow - 1, 10).getValues(); }, 'listExcludedRmsNow: read RM_Hierarchy');
  const excludedRows = [];
  rows.forEach(function (row, i) {
    if (row[7]) excludedRows.push({ rowNum: i + 2, name: row[2], team: row[0], role: row[1], note: row[8] });
  });

  Logger.log('RM_Hierarchy: ' + rows.length + ' total people, ' + excludedRows.length + ' currently marked Excluded.');
  excludedRows.forEach(function (r) {
    Logger.log('  Row ' + r.rowNum + ': ' + r.name + ' (' + r.team + ', ' + r.role + ')' + (r.note ? ' — note: ' + r.note : ''));
  });
  if (excludedRows.length) {
    Logger.log('If none of these were meant to be excluded, run clearAllRmHierarchyExclusionsNow to un-check all of them at once (or un-check individual boxes by hand in the sheet).');
  }
}

// ONE-OFF: un-checks Excluded for EVERY row in RM_Hierarchy — run this
// only after reviewing listExcludedRmsNow's output and confirming none of
// those exclusions were intentional. Clears the sheet's checkboxes
// directly; does not touch anything else (tl/tm/rh/ch/note/email are all
// left exactly as they are). Safe to run more than once — a row that's
// already un-excluded is simply left alone.
function clearAllRmHierarchyExclusionsNow() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(RM_HIERARCHY_SHEET_);
  if (!sheet) { Logger.log('RM_Hierarchy sheet not found.'); return; }
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) { Logger.log('RM_Hierarchy is empty.'); return; }

  const range = withRetry_(function () { return sheet.getRange(2, 8, lastRow - 1, 1); }, 'clearAllRmHierarchyExclusionsNow: read Excluded column');
  const values = range.getValues();
  let cleared = 0;
  const next = values.map(function (row) {
    if (row[0]) { cleared++; return [false]; }
    return row;
  });
  withRetry_(function () { range.setValues(next); }, 'clearAllRmHierarchyExclusionsNow: write cleared Excluded column');
  Logger.log('Cleared Excluded on ' + cleared + ' row(s) out of ' + values.length + ' total. Re-run listExcludedRmsNow to confirm the list is now empty, then re-run backfillTodaysOvernightLogRecipientsNow (OvernightEmailer.gs) to pick up the newly-resolvable RMs for today.');
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
    if (p.excluded) return; // hand-flagged rows don't create a manager-directory entry on their own
    if (p.tl) record(p.tl, 'TL', p.team);
    if (p.tm) record(p.tm, 'TM', p.team);
    if (p.rh) record(p.rh, 'RH', p.team);
    if (p.ch) record(p.ch, 'CH', p.team);
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
 * table directly) into: { byRmNameLower: {tl, tm, rh, ch, excluded},
 * emailByManagerNameLower: string }. Used by OvernightEmailer.gs to
 * resolve recipients at send time.
 */
function loadRmHierarchyAndEmails_(ss) {
  ensureRmHierarchySheet_(ss);
  ensureManagerDirectorySheet_(ss);
  return withRetry_(function () {
    const hierarchySheet = ss.getSheetByName(RM_HIERARCHY_SHEET_);
    const hLastRow = hierarchySheet.getLastRow();
    const byRmNameLower = {};
    if (hLastRow >= 2) {
      hierarchySheet.getRange(2, 1, hLastRow - 1, 10).getValues().forEach(function (row) {
        const name = String(row[2] || '').trim();
        if (!name) return;
        byRmNameLower[name.toLowerCase()] = {
          role: String(row[1] || '').trim(),
          tl: String(row[3] || '').trim(), tm: String(row[4] || '').trim(),
          rh: String(row[5] || '').trim(), ch: String(row[6] || '').trim(),
          excluded: !!row[7],
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
// Name -> email for that same senior leadership, keyed lowercase — needed
// separately from ALWAYS_CC_EMAILS_ (which only has the emails) because
// resolveRecipientBucketsForRms_ below needs to recognize one of THEM
// personally holding a lead by NAME. Deliberately NOT looked up via
// Manager_Directory: that sheet only ever records a name that appears AS
// someone else's tl/tm/rh/ch reference (see
// ensureManagerDirectorySheetInternal_'s own `record()` calls) — since
// nobody's ch/rh/tm/tl field ever names the CEO (they're above even the
// CH tier), Ashish Kukreja can never get an entry there no matter how
// the sheet is rebuilt. Kept in sync with ALWAYS_CC_EMAILS_.
const LEADERSHIP_NAME_TO_EMAIL_ = {
  'ashish kukreja': 'ashish.kukreja@homesfy.in',
  'saurabh mishra': 'saurabh.mishra@homesfy.in',
};


// A real allowlist of the genuine top-of-org labels actually used in
// RM_Hierarchy today (found by auditing every row whose own tl/tm/rh/ch
// are ALL blank) — used ONLY to judge the REPORTING RM's own role (are
// THEY personally at leadership/CH level, with nobody below them),
// never a resolved primary's role — a resolved primary is always a
// normal recipient regardless of tier now (see
// resolveRecipientBucketsForRms_ below). An unrecognized role does NOT
// match here, which is the safe direction: a genuinely new top-tier
// label would
// just stay unresolved (prompting a human to check it) rather than
// silently being treated as self-CH-alertable.
const TOP_OF_ORG_ROLES_ = ['cluster head', 'city lead', 'commercial head'];
function isTopOfOrgRole_(role) {
  return TOP_OF_ORG_ROLES_.indexOf(String(role || '').trim().toLowerCase()) !== -1;
}

/**
 * For a set of RM names (whoever had overnight activity in one region),
 * groups them into one bucket PER DISTINCT primary recipient — never
 * combines multiple managers into one email. "To" must always name
 * exactly ONE person, so a region with 4 Team Leads produces 4 buckets
 * here, not 1 combined email with all 4 in To.
 *
 * Each bucket's primary recipient is the RM's own immediate manager,
 * whichever tier that actually is: Team Lead (A1), else TM, else RH,
 * else CH — falling further up the chain only when the nearer tier
 * doesn't exist for this specific person. A resolved primary landing on
 * a genuine Cluster/Commercial Head/City Lead is a NORMAL bucket like
 * any other now (per explicit correction) — e.g. Rahul Poudel/Ayaz
 * Bagwan (Pune TMs) personally holding a lead routes straight to their
 * own manager Sourabh Sareen (Pune's City Lead), the same as any other
 * TM's lead routing to their RH would. `chLevelRms` below is reserved
 * for a narrower, genuinely exceptional case: someone AT leadership or
 * CH/City-Lead level THEMSELVES personally holding the lead, with
 * nobody at all below them to route it through — see chLevelRms's own
 * comment just below. Business rule this implements explicitly: for
 * automated email purposes, every TM is
 * ALSO treated as an A1 (gets their own bucket) — EXCEPT Pune's two TMs
 * who already have real A1s under them (Ayaz Bagwan -> Omkar
 * Ghate/Firoj Shaikh; Rahul Poudel -> Prathamesh A Pande/Nayan Pabale).
 * Nothing extra to special-case for that exception: anyone reporting to
 * one of those real A1s already has `tl` filled with the A1's own name
 * on their own row (not blank), so `chain.tl` is checked FIRST above and
 * the TM is never reached for them — a TM only becomes primary for
 * someone who genuinely has no A1 above them at all.
 *
 * Each bucket's Cc is ALWAYS_CC_EMAILS_ plus whichever of RH/CH exist on
 * the PRIMARY's OWN row (not the reporting RM's row — Book7 doesn't
 * always carry every intermediate tier on a deeply-nested S1's own row,
 * but the primary's own row always does) — EXCEPT TM, which is Cc'd only
 * for Pune's two exception TMs (PUNE_TM_STILL_CC_ below — Ayaz Bagwan,
 * Rahul Poudel): a person's direct manager already IS the "To", so
 * looping in their TM too is redundant UNLESS that TM has real A1s under
 * them (the Pune case), where dropping them from Cc would lose the one
 * TM-level person actually still relevant there. Minus the primary's own
 * email either way (never cc someone already in To).
 *
 * Returns { buckets: [{ primaryName, primaryEmail, primaryRole, cc:
 * [emails], rmNames: [...] }], unresolved: [{rmName, reason} — no chain
 * found, excluded, or no resolvable primary email — callers route these
 * through the legacy Region_Recipients fallback, or report the reason if
 * even that's blank], chLevelRms: [{ rmName, chName, chEmail }] — ONLY
 * for an RM AT leadership or CH/City-Lead level THEMSELVES personally
 * holding the lead, with nobody below them to route it through; callers
 * send these to ops instead of the CH/leadership person directly }.
 */
// The only TM-level names that still appear in Cc — see this function's
// own docblock for why (each has real A1s under them; dropping them from
// Cc would lose the one still-relevant TM-level person on those specific
// A1s' buckets).
const PUNE_TM_STILL_CC_ = ['ayaz bagwan', 'rahul poudel'];

// The leads sheet's own RM column sometimes has role/position text
// appended after a person's real name — two confirmed real cases:
// "Prajwal Shetty S 1 Account" and "Rahan Khan S 1", both really just
// that person's plain name with " S 1[...]" tacked on (their role in
// RM_HIERARCHY_RAW_ is "S1"). Per explicit instruction, role/position
// text must never be treated as part of the name for matching purposes.
// Strips a trailing "S <digits> ..." suffix — used ONLY as a fallback
// when the exact name doesn't resolve (see its call site), so it can
// never change the outcome for a name that already matches correctly.
const ROLE_SUFFIX_RE_ = /\s+s\s*\d+.*$/i;
function stripRoleSuffix_(name) {
  return String(name || '').trim().replace(ROLE_SUFFIX_RE_, '').trim();
}

// Looks up an RM name in byRmNameLower, first exactly, then (only if
// that fails) with a trailing role/position suffix stripped — see
// stripRoleSuffix_'s own comment. Shared by resolveRecipientBucketsForRms_
// below and debugFollowupStatusNow's own trace (OvernightEmailer.gs) so
// the diagnostic never disagrees with what a real send would actually do.
function lookupRmChain_(byRmNameLower, rmName) {
  const exact = String(rmName || '').trim().toLowerCase();
  if (byRmNameLower[exact]) return byRmNameLower[exact];
  const stripped = stripRoleSuffix_(rmName).toLowerCase();
  if (stripped && stripped !== exact) return byRmNameLower[stripped];
  return undefined;
}

function resolveRecipientBucketsForRms_(ss, rmNames) {
  const data = loadRmHierarchyAndEmails_(ss);
  const buckets = {}; // lowercased primaryName -> { primaryName, primaryEmail, primaryRole, ccSet, rmNames }
  const unresolved = [];
  const chLevelRms = [];

  rmNames.forEach(function (rmName) {
    const chain = lookupRmChain_(data.byRmNameLower, rmName);
    if (!chain) {
      // Recognized senior leadership (LEADERSHIP_NAME_TO_EMAIL_)
      // personally holding a lead, but with NO row in RM_Hierarchy at
      // all — not a hierarchy gap to fix, they just aren't a normal
      // RM/CH row (e.g. the CEO). Same "nobody above them" situation as
      // the blank-chain CH case just below, reached from a different
      // starting point. Real production case: Ashish Kukreja (confirmed
      // CEO via Book7's own "Ashish Kukreja CEO" alias) personally held
      // an overnight lead. Checked via LEADERSHIP_NAME_TO_EMAIL_, not
      // Manager_Directory — see that constant's own comment for why a
      // Manager_Directory lookup can never work for the CEO specifically.
      const leadershipEmail = LEADERSHIP_NAME_TO_EMAIL_[String(rmName).trim().toLowerCase()];
      if (leadershipEmail) {
        // No RM_Hierarchy row to read a real title from (that's the whole
        // reason this branch exists — see the comment above) — 'Leadership'
        // is a deliberate fallback label, not a guessed title.
        chLevelRms.push({ rmName: rmName, chName: rmName, chEmail: leadershipEmail, chRole: 'Leadership' });
        return;
      }
      unresolved.push({ rmName: rmName, reason: 'Not found in RM_Hierarchy (even after trying with a trailing role/position suffix stripped)' }); return;
    }
    if (chain.excluded) { unresolved.push({ rmName: rmName, reason: 'Found in RM_Hierarchy but marked Excluded' }); return; }

    // This RM IS ALREADY the top of their own chain (no TL/TM/RH/CH
    // above them at all) AND their own role is a genuine top-of-org
    // label — they're personally holding this lead with nobody to
    // route it to, same underlying situation as an ordinary RM's chain
    // resolving up to a CH below (just one level shorter), so it gets
    // the same richer CH-level alert instead of falling all the way to
    // a bare "unresolved, no recipient" ops ping. Real production case:
    // Vidya Jadhav (Navi Mumbai Cluster Head), Sourabh Sareen (Pune City
    // Lead), and Bipin More (Thane Cluster Head) each personally held an
    // overnight lead — every one landed in `unresolved` before this,
    // since a fully-blank chain looks identical to a genuine hierarchy
    // gap (see isTopOfOrgRole_'s own comment on why this is a narrow,
    // real allowlist rather than judging by role tier broadly).
    if (!chain.tl && !chain.tm && !chain.rh && !chain.ch && isTopOfOrgRole_(chain.role)) {
      const selfEmail = data.emailByManagerNameLower[String(rmName).trim().toLowerCase()];
      if (selfEmail) {
        // Real recorded role (e.g. "Cluster Head", "City Lead", "Commercial
        // Head") — whichever of the three isTopOfOrgRole_ matched, not a
        // generic "CH" stand-in. Real production case: Sourabh Sareen's own
        // RM_Hierarchy row says "City Lead", not "Cluster Head" — both are
        // top-of-org for routing purposes, but the email should show what's
        // actually on record for him, not a label that reads as the wrong
        // title.
        chLevelRms.push({ rmName: rmName, chName: rmName, chEmail: selfEmail, chRole: chain.role });
        return;
      }
      // No resolvable email even for themselves — genuinely nothing to
      // alert with; falls through to the normal unresolved path below.
    }

    const primaryName = chain.tl || chain.tm || chain.rh || chain.ch || '';
    if (!primaryName) { unresolved.push({ rmName: rmName, reason: 'Found in RM_Hierarchy, but has no TL/TM/RH/CH on record at all' }); return; }
    const primaryEmail = data.emailByManagerNameLower[primaryName.toLowerCase()];
    if (!primaryEmail) { unresolved.push({ rmName: rmName, reason: 'Reports to "' + primaryName + '", but that manager has no email in Manager_Directory' }); return; }

    // Prefer the primary's OWN chain (see docblock above); fall back to
    // the reporting RM's chain only if the primary has no row of their
    // own in the hierarchy (shouldn't normally happen, since they
    // resolved to a real email above, but stay defensive).
    const key = primaryName.toLowerCase();
    const primaryChain = data.byRmNameLower[key] || chain;

    if (!buckets[key]) buckets[key] = { primaryName: primaryName, primaryEmail: primaryEmail, primaryRole: primaryChain.role, ccSet: new Set(), rmNames: [] };
    const ccCandidates = [primaryChain.rh, primaryChain.ch];
    if (PUNE_TM_STILL_CC_.indexOf(String(primaryChain.tm || '').trim().toLowerCase()) !== -1) {
      ccCandidates.push(primaryChain.tm);
    }
    ccCandidates.forEach(function (name) {
      if (!name) return;
      const email = data.emailByManagerNameLower[name.toLowerCase()];
      if (email) buckets[key].ccSet.add(email);
    });
    buckets[key].rmNames.push(rmName);
  });

  const bucketList = Object.keys(buckets).sort().map(function (key) {
    const b = buckets[key];
    ALWAYS_CC_EMAILS_.forEach(function (e) { b.ccSet.add(e); });
    b.ccSet.delete(b.primaryEmail); // don't cc someone already in To
    return { primaryName: b.primaryName, primaryEmail: b.primaryEmail, primaryRole: b.primaryRole, cc: Array.from(b.ccSet), rmNames: b.rmNames };
  });

  return { buckets: bucketList, unresolved: unresolved, chLevelRms: chLevelRms };
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

/**
 * The Customer Terms & Conditions, as supplied by DriverZone (DriverZone_Customer_Terms_and_Conditions,
 * v1.0, effective 10 May 2026). Kept as data rather than JSX so a wording change is an edit here and
 * nothing else — `app/info/[topic].tsx` only lays it out. Copy is verbatim from the document; do not
 * reword it here without the company's say-so, it is their legal text.
 */

export interface LabelledItem {
  label: string;
  text: string;
}

export type TermsBlock =
  | { kind: 'p'; text: string }
  | { kind: 'subheading'; text: string }
  | { kind: 'bullets'; items: string[] }
  | { kind: 'labelled'; items: LabelledItem[] };

export interface TermsSection {
  heading: string;
  blocks: TermsBlock[];
}

export const CUSTOMER_TERMS = {
  version: '1.0',
  effectiveDate: '10 May 2026',
  jurisdiction: 'Republic of India  |  Forum: Jalpaiguri, West Bengal',
  intro:
    'These Customer Terms & Conditions ("Terms") govern access to and use of cab booking, transportation facilitation, website, mobile application, customer support, and all related services provided by Driver Zone ("Driver Zone", "Company", "we", "our", or "us"). By accessing, booking, or using any Driver Zone service, the Customer ("you", "your", or "User") agrees to be legally bound by these Terms. Please read them carefully.',
  sections: [
    {
      heading: 'A. Definitions',
      blocks: [
        {
          kind: 'p',
          text: 'In these Terms and Conditions, the following words and expressions shall have the meanings assigned to them below, unless the context clearly requires otherwise:',
        },
        {
          kind: 'labelled',
          items: [
            { label: '"Account"', text: 'The registered user profile created by a Customer on the Driver Zone platform, enabling access to bookings and related services.' },
            { label: '"Admin"', text: 'A person designated by a corporate or organisational customer to manage Driver Zone services on behalf of their organisation, including managing authorised users and usage limits.' },
            { label: '"Applicable Law"', text: 'All laws, statutes, regulations, rules, orders, notifications, guidelines, and directions of the Republic of India in force and applicable to the use of the Driver Zone platform and services, as amended from time to time.' },
            { label: '"Booking"', text: 'A confirmed request made by a Customer through the Driver Zone platform for the deployment of a Driver for transportation or related services.' },
            { label: '"Cancellation Charge"', text: 'The fee payable by the Customer upon cancellation of a confirmed Booking, the quantum of which depends on the stage of the booking and whether a Driver has been assigned or has reported.' },
            { label: '"Confidential Information"', text: 'Any non-public information disclosed by either party in connection with Driver Zone services, including personal data, account credentials, business information, and pricing details.' },
            { label: '"Customer / You / Your"', text: 'Any individual, company, or organisation that accesses, registers on, or uses the Driver Zone platform or avails any services offered through it.' },
            { label: '"Driver"', text: 'A professional driver empanelled with or deployed through Driver Zone to provide transportation or driver-related services to Customers.' },
            { label: '"Driver Zone / We / Us / Our"', text: 'The Driver Zone platform, its owners, operators, and affiliated personnel responsible for facilitating driver-based transportation services.' },
            { label: '"Force Majeure Event"', text: 'Any event or circumstance beyond the reasonable control of Driver Zone, including natural disasters, floods, earthquakes, acts of God, wars, civil unrest, strikes, government directives, pandemics, or widespread infrastructure failures.' },
            { label: '"Intellectual Property Rights"', text: 'All rights relating to patents, trademarks, trade names, service marks, copyrights, logos, designs, software, source code, and any other proprietary rights associated with the Driver Zone platform, brand, and content.' },
            { label: '"Login Credentials"', text: 'The username, password, OTP, or any other authentication detail used by a Customer to access their Account on the Driver Zone platform.' },
            { label: '"Personal Data"', text: 'Any information that can directly or indirectly identify a Customer, including name, contact number, email address, location data, and payment details.' },
            { label: '"Platform"', text: 'The Driver Zone website, mobile application, dashboard, and any other digital interface through which Customers access and use Driver Zone services.' },
            { label: '"Service Charges"', text: 'All fees payable by the Customer for services availed through Driver Zone, including applicable taxes, toll charges, parking fees, and any other notified charges.' },
            { label: '"Services"', text: 'The driver deployment, booking facilitation, and transportation support services provided or facilitated by Driver Zone through the Platform, as described in these Terms.' },
            { label: '"Terms"', text: 'This document, including all clauses, schedules, and amendments published on the Driver Zone platform from time to time.' },
            { label: '"Third Party"', text: 'Any person or entity other than the Customer and Driver Zone, including external payment gateways, insurance providers, and third-party service integrations.' },
            { label: '"Vehicle"', text: 'Any motor vehicle used or deployed in the provision of transportation services under a Booking made through the Driver Zone platform.' },
          ],
        },
      ],
    },
    {
      heading: 'B. Rules of Interpretation',
      blocks: [
        { kind: 'p', text: 'Unless the context otherwise requires, the following rules of interpretation apply throughout these Terms:' },
        {
          kind: 'labelled',
          items: [
            { label: 'Singular and Plural', text: 'Words in the singular include the plural, and vice versa.' },
            { label: 'Gender', text: 'Words referring to any gender include all other genders.' },
            { label: 'Headings', text: 'Section and clause headings are for ease of reference only and shall not affect the interpretation of these Terms.' },
            { label: '"Including"', text: 'The word "including" or "includes" shall be read as "including but not limited to" and shall not restrict the generality of the words preceding it.' },
            { label: 'References to Law', text: 'Any reference to a law, statute, or regulation includes all amendments, re-enactments, or replacements of that law from time to time.' },
            { label: 'References to Clauses', text: 'Any reference to a "Clause" or "Section" is a reference to a clause or section within these Terms, unless expressly stated otherwise.' },
            { label: 'Reasonableness', text: 'Where Driver Zone is permitted to act at its "discretion" or "sole discretion", such discretion shall be exercised reasonably and in good faith.' },
            { label: 'Electronic Record', text: 'This document constitutes an electronic record within the meaning of the Information Technology Act, 2000, and the rules thereunder. It does not require a physical or digital signature to be legally valid and binding.' },
            { label: 'Conflict', text: 'In the event of any conflict between these Terms and any other communication or representation made by Driver Zone, these Terms shall prevail.' },
          ],
        },
      ],
    },
    {
      heading: '1. About Driver Zone & Nature of Services',
      blocks: [
        { kind: 'p', text: 'Driver Zone is a professional transportation facilitation platform providing cab booking, driver deployment, ride coordination, and related transportation support services. We connect passengers and organisations with skilled, vetted drivers for a wide range of transportation needs.' },
        { kind: 'p', text: 'Unless Driver Zone expressly states otherwise, it acts as a facilitator and intermediary between Customers and independent drivers, vehicle owners, or transport service providers — coordinating and managing bookings, while the transportation itself is carried out by the drivers operating through our platform.' },
      ],
    },
    {
      heading: '2. Eligibility',
      blocks: [
        { kind: 'p', text: 'To access and use Driver Zone services, you must satisfy each of the following conditions:' },
        {
          kind: 'bullets',
          items: [
            'Be at least 18 (eighteen) years of age.',
            'Have the legal capacity to enter into a binding agreement under Applicable Law.',
            'Provide true, accurate, current, and complete information when registering or making a Booking.',
          ],
        },
        { kind: 'p', text: 'Driver Zone reserves the right to suspend or terminate any account where false, inaccurate, or misleading information has been provided, without prior notice and without prejudice to any other remedy available in law.' },
      ],
    },
    {
      heading: '3. Account Registration & Security',
      blocks: [
        { kind: 'p', text: 'Certain Driver Zone services require you to create and maintain an Account. By registering an Account, you represent and warrant that:' },
        {
          kind: 'labelled',
          items: [
            { label: 'Confidentiality', text: 'You shall keep your Login Credentials strictly private and shall not share them with any third party.' },
            { label: 'Accuracy', text: 'You shall maintain accurate and current Account information and update your details promptly upon any change.' },
            { label: 'Responsibility', text: 'You are solely responsible for all activities that occur under your Account, whether or not authorised by you.' },
            { label: 'Non-Transferability', text: 'Your Account is personal to you and may not be transferred, assigned, or sold to any other person or entity.' },
          ],
        },
        { kind: 'p', text: 'In the event of any actual or suspected unauthorised access to or use of your Account, you must notify Driver Zone immediately through the official support channel. Driver Zone shall not be liable for any loss arising from your failure to comply with this obligation.' },
      ],
    },
    {
      heading: '4. Bookings & Service Availability',
      blocks: [
        { kind: 'p', text: 'Driver Zone shall endeavour to fulfil every confirmed Booking; however, the following conditions apply:' },
        {
          kind: 'bullets',
          items: [
            'All Bookings are subject to driver availability and operational conditions prevailing at the time of the request.',
            'Driver Zone reserves the right to accept, reject, reschedule, or cancel any Booking at its discretion, including in circumstances beyond its reasonable control.',
            'Driver reporting times are estimates only. Delays may occur due to traffic congestion, adverse weather, road closures, vehicle issues, or other unforeseen events.',
            'In the event of an anticipated delay, Driver Zone shall make reasonable efforts to notify the Customer at the earliest practicable opportunity.',
          ],
        },
      ],
    },
    {
      heading: '5. Fare Structure, Payments & Charges',
      blocks: [
        { kind: 'p', text: 'The Customer agrees to pay all applicable Service Charges in connection with each Booking. Such charges may include, without limitation, the following components:' },
        {
          kind: 'bullets',
          items: [
            'Base fare and distance charges',
            'Time charges and driver allowance',
            'Toll tax, state taxes, and interstate permit charges',
            'Parking fees and waiting charges',
            'Night duty charges and early-morning reporting charges',
            'Charges for additional stoppages, route deviations, or extended usage',
            'Hill-area or restricted-zone surcharges',
            'Applicable GST and all other statutory taxes and levies',
          ],
        },
        { kind: 'p', text: 'All applicable charges will be communicated to the Customer prior to the completion of a Booking, wherever operationally practicable. Payment may be made through any of the following approved modes:' },
        {
          kind: 'bullets',
          items: [
            'Unified Payments Interface (UPI)',
            'Cash',
            'Online payment gateways',
            'Bank transfer (NEFT / RTGS / IMPS)',
            'Digital wallets or any other method approved by Driver Zone',
          ],
        },
        { kind: 'p', text: 'Failure or refusal to make payment of Service Charges shall entitle Driver Zone to immediately suspend services and to initiate recovery proceedings as permitted under Applicable Law.' },
      ],
    },
    {
      heading: '6. Waiting Time & Additional Charges',
      blocks: [
        { kind: 'p', text: 'Customers are requested to be present at the designated pickup location at the scheduled time. The following provisions govern waiting time and additional charges:' },
        {
          kind: 'bullets',
          items: [
            'Waiting charges shall accrue from the expiry of any applicable complimentary waiting period at the rate notified by Driver Zone from time to time.',
            'Additional charges may apply for extra stoppages, route modifications, extended trip durations, late-night duties, early-morning reporting, additional passengers, excess luggage, or travel through hill areas or restricted zones.',
            'All such additional charges shall form part of the final payable amount and shall be communicated to the Customer as soon as reasonably practicable.',
          ],
        },
      ],
    },
    {
      heading: '7. Cancellations & Refunds',
      blocks: [
        { kind: 'subheading', text: '7.1 Cancellation by the Customer' },
        {
          kind: 'bullets',
          items: [
            'The Customer may cancel a confirmed Booking at any time through the Driver Zone platform.',
            'Cancellation Charges may apply depending on the timing of cancellation and whether a Driver has been assigned or has reported to the pickup location.',
            'Applicable Cancellation Charges will be clearly communicated to the Customer prior to confirmation of the cancellation.',
            "Refunds, where applicable, shall be processed within the timeframe applicable to the Customer's payment mode and the relevant banking or payment gateway process.",
          ],
        },
        { kind: 'subheading', text: '7.2 Cancellation by Driver Zone' },
        { kind: 'p', text: 'Driver Zone reserves the right to cancel or reschedule a confirmed Booking in the following circumstances:' },
        {
          kind: 'bullets',
          items: [
            'Non-availability of a suitable Driver at the time of the Booking.',
            'Safety or security concerns affecting the Driver, Customer, or the journey.',
            'Occurrence of a Force Majeure Event, including natural disasters, civil unrest, or government directives.',
            "Operational limitations beyond Driver Zone's reasonable control.",
          ],
        },
        { kind: 'p', text: 'In the event Driver Zone cancels a confirmed Booking, the Customer shall be entitled to a full refund of any amount already paid in respect of that Booking.' },
      ],
    },
    {
      heading: '8. Customer Conduct & Obligations',
      blocks: [
        { kind: 'p', text: 'By using Driver Zone services, the Customer agrees to comply with the following obligations and standards of conduct:' },
        {
          kind: 'bullets',
          items: [
            'Treat all Drivers and Driver Zone support staff with courtesy, respect, and professionalism at all times.',
            'Refrain from engaging in any form of verbal or physical abuse, harassment, intimidation, or threatening behaviour directed at any Driver or Driver Zone personnel. Violation of this obligation shall entitle Driver Zone to immediately terminate the service without refund.',
            'Not instruct, pressure, or encourage any Driver to breach traffic laws, speed limits, or applicable safety regulations.',
            'Not smoke, consume alcohol, narcotics, or any other prohibited substances inside a Vehicle, unless expressly permitted by law and Driver Zone.',
            'Not cause damage to any Vehicle or to any property belonging to a Driver.',
            'Use the Platform exclusively for lawful purposes and not engage in any fraudulent, deceptive, or unauthorised activity.',
            'Not attempt to damage the reputation or operations of Driver Zone through the publication of false reviews, the spread of misinformation, or any other means.',
          ],
        },
        { kind: 'p', text: 'The Customer shall not carry or transport any of the following in any Vehicle:' },
        {
          kind: 'bullets',
          items: [
            'Explosives or hazardous materials of any kind',
            'Illegal substances or narcotic drugs',
            'Weapons prohibited under Applicable Law',
            'Any other goods or materials restricted by Applicable Law',
          ],
        },
        { kind: 'p', text: 'Driver Zone reserves the right to terminate services immediately and without refund in the event of misconduct, abuse, or violation of this Section by the Customer.' },
      ],
    },
    {
      heading: '9. Driver & Vehicle Standards',
      blocks: [
        { kind: 'p', text: 'Driver Zone endeavours to ensure that all Drivers operating through its platform meet the following professional standards:' },
        {
          kind: 'bullets',
          items: [
            'Maintain professional conduct, appropriate attire, and a courteous disposition at all times.',
            'Hold valid driving licences and all other documents required under Applicable Law.',
            'Adhere to all applicable traffic laws, transport regulations, and safety norms.',
            "Maintain reasonable punctuality and comply with Driver Zone's operational guidelines.",
            'Respect the privacy and dignity of the Customer throughout the journey.',
          ],
        },
        { kind: 'p', text: 'Driver Zone does not independently guarantee the conduct, actions, or omissions of independent transport service providers in every instance. Vehicle type, model, colour, or amenities may vary depending on operational availability. Customers are encouraged to report any driver who fails to meet these standards to Driver Zone, and where operationally feasible, a replacement driver will be arranged.' },
      ],
    },
    {
      heading: '10. Safety & Emergency Procedures',
      blocks: [
        { kind: 'p', text: 'Both Customers and Drivers are required to comply with all applicable traffic and safety laws throughout the course of every journey. Customers are advised to observe the following safety practices:' },
        {
          kind: 'bullets',
          items: [
            'Verify Driver identity and Vehicle details against the information provided in the Booking confirmation before commencing travel.',
            'Wear seat belts at all times, wherever fitted and legally required.',
            'Refrain from sharing ride OTPs with any person other than for the purpose of verifying the commencement of a trip.',
            'Report any emergency, misconduct, or safety concern to the relevant authorities and to Driver Zone promptly.',
          ],
        },
        { kind: 'p', text: 'In the event of an emergency, Driver Zone may disclose relevant information to law enforcement authorities or emergency responders where legally required or where necessary to protect life. If you encounter a safety concern during a trip, contact the relevant emergency services immediately and notify Driver Zone support as soon as it is safe to do so.' },
      ],
    },
    {
      heading: '11. Personal Belongings',
      blocks: [
        { kind: 'p', text: 'Customers are solely and exclusively responsible for the safekeeping of their personal belongings at all times during a trip. Driver Zone shall not be liable, whether directly or indirectly, for any loss, theft, damage, misplacement, or failure to recover any unattended item left inside a Vehicle. Driver Zone may, at its discretion, provide reasonable assistance in recovery efforts, subject to operational feasibility, but assumes no legal obligation to do so.' },
      ],
    },
    {
      heading: '12. Non-Circumvention of Driver Zone',
      blocks: [
        { kind: 'p', text: "Drivers are introduced to Customers exclusively through the Driver Zone platform. In consideration of Driver Zone's investment in sourcing, vetting, and managing its driver network, the Customer irrevocably agrees that, without the prior written consent of Driver Zone, the Customer shall not:" },
        {
          kind: 'bullets',
          items: [
            'Directly hire, solicit, privately engage, or otherwise employ any Driver introduced through Driver Zone services.',
            'Attempt to bypass or circumvent the Driver Zone platform by arranging transportation directly with any such Driver.',
          ],
        },
        { kind: 'p', text: "Breach of this Section shall entitle Driver Zone to terminate the Customer's Account, seek compensation for loss of revenue, and initiate such legal proceedings as Driver Zone deems appropriate." },
      ],
    },
    {
      heading: '13. Limitation of Liability',
      blocks: [
        { kind: 'p', text: 'To the maximum extent permitted under Applicable Law, Driver Zone shall not be liable to the Customer or any third party for any of the following:' },
        {
          kind: 'bullets',
          items: [
            "Delays attributable to traffic conditions, adverse weather, road closures, strikes, political disturbances, or any other event beyond Driver Zone's reasonable control.",
            "Mechanical failures or breakdowns of Vehicles not directly within Driver Zone's operational control.",
            'Missed flights, trains, meetings, appointments, or any other consequential events.',
            'Loss, theft, or damage to personal belongings left unattended in a Vehicle.',
            'Acts, omissions, negligence, or misconduct of independent Drivers or third-party transport operators.',
            'Indirect, incidental, special, exemplary, or consequential damages of any nature whatsoever.',
          ],
        },
        { kind: 'p', text: "Driver Zone services are provided on a commercially reasonable, best-effort basis. Nothing in these Terms shall limit Driver Zone's liability for death or personal injury caused by its own proven negligence, or for fraudulent misrepresentation, to the extent such limitation is prohibited by Applicable Law." },
      ],
    },
    {
      heading: '14. Privacy & Data Protection',
      blocks: [
        { kind: 'p', text: "Driver Zone is committed to protecting the privacy of its Customers. By using Driver Zone services, you consent to Driver Zone's collection, storage, and processing of the following categories of Personal Data:" },
        {
          kind: 'bullets',
          items: [
            'Full name and contact details (including mobile number and email address).',
            'Location data, used for the purpose of matching you with nearby Drivers.',
            'Booking history and service-related transactional information.',
            'Device identifiers and usage information collected for platform security and improvement.',
          ],
        },
        { kind: 'p', text: 'Personal Data is processed solely for operational, safety, legal compliance, and service improvement purposes. Driver Zone implements reasonable technical and organisational security measures to protect Personal Data from unauthorised access, disclosure, or loss. Driver Zone does not sell Personal Data to any third party.' },
      ],
    },
    {
      heading: '15. Intellectual Property',
      blocks: [
        { kind: 'p', text: 'All content available on or through the Driver Zone platform — including, without limitation, the Driver Zone name and logo, website design, mobile application interface, graphics, text, software, and proprietary algorithms — constitutes the exclusive intellectual property of Driver Zone and is protected under applicable intellectual property legislation.' },
        { kind: 'p', text: 'No Customer or third party may copy, reproduce, modify, distribute, publicly display, reverse-engineer, or commercially exploit any part of the Driver Zone platform or its content without the prior explicit written authorisation of Driver Zone.' },
      ],
    },
    {
      heading: '16. Suspension & Termination',
      blocks: [
        { kind: 'p', text: "Driver Zone reserves the right to suspend, restrict, or permanently terminate a Customer's access to the Platform and Services, with or without prior notice, in any of the following circumstances:" },
        {
          kind: 'bullets',
          items: [
            'Breach of any provision of these Terms.',
            "Detection of fraudulent, abusive, or unlawful activity on or through the Customer's Account.",
            'Outstanding and unresolved payment obligations.',
            'Any threat to the safety, security, or integrity of the Platform, Drivers, or other Customers.',
            'Legal or regulatory compulsion requiring immediate action.',
          ],
        },
        { kind: 'p', text: 'Where suspension or termination does not involve an immediate safety or legal risk, Driver Zone shall endeavour to provide the Customer with reasonable prior notice. Termination shall not affect any accrued rights or obligations of either party existing as at the date of termination.' },
      ],
    },
    {
      heading: '17. Amendments to These Terms',
      blocks: [
        { kind: 'p', text: 'Driver Zone reserves the right to amend, revise, or update these Terms at any time, in order to reflect changes in its services, applicable legislation, regulatory requirements, or operational best practices. Any amendments shall take effect immediately upon publication of the revised Terms on the official Driver Zone platform, application, or website.' },
        { kind: 'p', text: "The Customer's continued access to or use of Driver Zone services following the publication of any amendments shall constitute acceptance of the revised Terms. Customers are encouraged to review these Terms periodically to remain informed of the current version." },
      ],
    },
    {
      heading: '18. Governing Law & Dispute Resolution',
      blocks: [
        {
          kind: 'bullets',
          items: [
            'These Terms and all matters arising out of or in connection with them shall be governed by, and construed in accordance with, the laws of the Republic of India.',
            'Any dispute, controversy, or claim arising out of or relating to the use of Driver Zone services or these Terms shall be subject to the exclusive jurisdiction of the courts of competent jurisdiction at Jalpaiguri, West Bengal.',
            "Prior to initiating any formal legal proceedings, Customers are encouraged to contact Driver Zone's support team with the details of their concern, to allow Driver Zone a reasonable opportunity to resolve the matter amicably.",
          ],
        },
      ],
    },
    {
      heading: '19. Contact Information',
      blocks: [
        { kind: 'p', text: "For support inquiries, complaints, feedback, billing disputes, or the service of legal notices, Customers may contact Driver Zone through the official contact details published on the Driver Zone website, mobile application, or booking platform. Driver Zone's support team shall endeavour to respond to all inquiries promptly and in good faith." },
      ],
    },
  ] satisfies TermsSection[],
  acceptance:
    'By accessing, registering on, or using any Driver Zone service — whether through our website, mobile application, or any other channel — you confirm that you have read, understood, and agreed to be legally bound by these Terms and Conditions in their entirety. If you do not agree with any part of these Terms, you must immediately cease using Driver Zone services.',
  closing: ['Thank you for choosing Driver Zone.', 'We look forward to serving you safely, reliably, and professionally.'],
};

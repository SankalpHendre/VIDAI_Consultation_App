import React from 'react'
import './SideBar.css'
import { IoIosChatboxes } from "react-icons/io";
import { MdSpeakerNotes } from "react-icons/md";
import { MdPerson } from "react-icons/md";
import { AiFillExclamationCircle } from "react-icons/ai";
import { FiExternalLink } from "react-icons/fi";

const InfoSideBar = ({ activeSidebar, setActiveSidebar, patientData }) => {
    return (
        <div className='sidebar-container'>
            {/* ── Tab Nav ── */}
            <div className='sidebar-nav'>
                <div className='nselected' onClick={() => setActiveSidebar(activeSidebar === "chat" ? null : "chat")}>
                    <IoIosChatboxes />
                </div>
                <div className='nselected' onClick={() => setActiveSidebar(activeSidebar === "notes" ? null : "notes")}>
                    <MdSpeakerNotes />
                </div>
                <div className='selected' onClick={() => setActiveSidebar(activeSidebar === "person" ? null : "person")}>
                    <MdPerson />
                    <span className='chat'>Information</span>
                </div>
                <div className='nselected' onClick={() => setActiveSidebar(activeSidebar === "alert" ? null : "alert")}>
                    <AiFillExclamationCircle />
                </div>
            </div>

            {/* ── Content ── */}
            <div className='sidebar-content'>
                {/* External link */}
                <div className='ext-link-row'>
                    <FiExternalLink size={14} />
                    <span>Go To Patient's Medical History</span>
                </div>

                {/* Patient info card */}
                <div className='info-section-title'>Patient Information</div>
                <div className='info-card'>
                    <div className='sname'>First Name :</div>
                    <div className='pname'>{patientData?.first_name || "N/A"}</div>

                    <div className='sname'>Last Name :</div>
                    <div className='pname'>{patientData?.last_name || "N/A"}</div>

                    <div className='sname'>Sex Assigned At Birth :</div>
                    <div className='pname'>{patientData?.sex || "N/A"}</div>

                    <div className='sname'>Mobile No :</div>
                    <div className='pname'>{patientData?.mobile || "N/A"}</div>

                    {/* Backend sends "date_of_birth" — matches this key exactly */}
                    <div className='sname'>Date of Birth :</div>
                    <div className='pname'>{patientData?.date_of_birth || "N/A"}</div>

                    <div className='sname'>Email ID :</div>
                    <div className='pname'>{patientData?.email || "N/A"}</div>
                </div>
            </div>

            <div className='sidebar-bottom' />
        </div>
    )
}

export default InfoSideBar
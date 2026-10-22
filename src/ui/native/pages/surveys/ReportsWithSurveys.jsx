import React from 'react';
import Reports from '../Reports';
import SurveyPanel from './SurveyPanel';
import TeamReports from '../reports/TeamReports';
import ReportsTabs from '../reports/ReportsTabs';
export default function ReportsWithSurveys(props){return <><ReportsTabs projectId={props.projectId} activeSection="reports"/><TeamReports key={props.projectId} {...props}/><Reports {...props}/><SurveyPanel {...props}/></>;}

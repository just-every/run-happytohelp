import React from 'react';
import Reports from '../Reports';
import SurveyPanel from './SurveyPanel';
import TeamReports from '../reports/TeamReports';
export default function ReportsWithSurveys(props){return <><TeamReports key={props.projectId} {...props}/><Reports {...props}/><SurveyPanel {...props}/></>;}

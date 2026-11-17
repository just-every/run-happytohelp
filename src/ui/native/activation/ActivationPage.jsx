import React from 'react';
import SetupList from './SetupList';
import CustomerNameStep from '../widget-setup/CustomerNameStep';
import WidgetAddressNotice from '../widget-setup/WidgetAddressNotice';
export default function ActivationPage({projectId,role}) {
 return <CustomerNameStep projectId={projectId}><WidgetAddressNotice projectId={projectId}/><SetupList projectId={projectId} role={role}/></CustomerNameStep>;
}

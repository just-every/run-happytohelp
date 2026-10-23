import React from 'react';
import campaignStyles from '../css/CampaignOffer.css?inline';

/* eslint import/no-webpack-loader-syntax: off */
import styles from '../css/Root.css?inline';
import requestFormStyles from '../css/RequestForms.css?inline';
import ratingStyles from '../css/ResolutionRating.css?inline';
import monitoringStyles from '../css/MonitoringConsent.css?inline';

// If we don't do this, when we load the app in pages with next.js the icons will be too large
//import { config } from '@fortawesome/fontawesome-svg-core'
/* eslint import/no-webpack-loader-syntax: off */
import fontawesome from '@fortawesome/fontawesome-svg-core/styles.css?inline';
//config.autoAddCss = false;

export default function Style(props) {
    return (
        <>
            <style type="text/css">{styles}</style>
            <style type="text/css">{campaignStyles}</style>
            <style type="text/css">{ratingStyles}</style>
            <style type="text/css">{requestFormStyles}</style>
            <style type="text/css">{monitoringStyles}</style>
            <style type="text/css">{fontawesome}</style>
        </>
    );
}

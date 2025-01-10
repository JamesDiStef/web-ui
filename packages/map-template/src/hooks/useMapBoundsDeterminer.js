import { useEffect, useState } from 'react';
import { useRecoilValue, useRecoilState } from 'recoil';
import getDesktopPaddingBottom from '../helpers/GetDesktopPaddingBottom';

// Recoil atoms
import bearingState from '../atoms/bearingState';
import categoriesState from '../atoms/categoriesState';
import kioskOriginLocationIdState from '../atoms/kioskOriginLocationIdState';
import locationIdState from '../atoms/locationIdState';
import mapsIndoorsInstanceState from '../atoms/mapsIndoorsInstanceState';
import pitchState from '../atoms/pitchState';
import startZoomLevelState from '../atoms/startZoomLevelState';
import currentVenueNameState from '../atoms/currentVenueNameState';
import venuesInSolutionState from '../atoms/venuesInSolutionState';
import venueWasSelectedState from '../atoms/venueWasSelectedState';
import isMapReadyState from '../atoms/isMapReadyState.js';

// Hooks
import getMobilePaddingBottom from '../helpers/GetMobilePaddingBottom';
import getDesktopPaddingLeft from '../helpers/GetDesktopPaddingLeft';
import { useInactive } from './useInactive';
import { useIsDesktop } from './useIsDesktop';

// Selectors
import currentPitchSelector from '../selectors/currentPitch';
import centerState from '../atoms/centerState';
import isNullOrUndefined from '../helpers/isNullOrUndefined';

// Turf
import * as turf from '@turf/turf';

/**
 * Determine where in the world to pan the map, based on the combination of venueName, locationId and kioskOriginLocationId.
 *
 * Returns two state variables:
 * - mapPositionInvestigating is set to true when map position is investigating. This is used to instruct the Map Template to start showing UI elements.
 * - mapPositionKnown is set to instruct the Map Template that the map is now ready to be shown to the user.
 */
const useMapBoundsDeterminer = () => {
    const [mapPositionInvestigating, setMapPositionInvestigating] = useState(false);
    const [mapPositionKnown, setMapPositionKnown] = useState(false);

    const isDesktop = useIsDesktop();
    const isInactive = useInactive();

    const bearing = useRecoilValue(bearingState);
    const categories = useRecoilValue(categoriesState);
    const kioskOriginLocationId = useRecoilValue(kioskOriginLocationIdState);
    const locationId = useRecoilValue(locationIdState);
    const mapsIndoorsInstance = useRecoilValue(mapsIndoorsInstanceState);
    const pitch = useRecoilValue(pitchState);
    const startZoomLevel = useRecoilValue(startZoomLevelState);
    const venuesInSolution = useRecoilValue(venuesInSolutionState);
    const currentPitch = useRecoilValue(currentPitchSelector);
    const venueWasSelected = useRecoilValue(venueWasSelectedState);
    const [kioskLocationDisplayRuleWasChanged, setKioskLocationDisplayRuleWasChanged] = useState(false);
    const [currentVenueName, setCurrentVenueName] = useRecoilState(currentVenueNameState);
    const isMapReady = useRecoilState(isMapReadyState);
    let center = useRecoilValue(centerState);

    /**
     * If the app is inactive, run code to reset to initial map position.
     */
    useEffect(() => {
        if (isInactive) {
            determineMapBounds();
        }
    }, [isInactive]);

    /*
     * When relevant state changes, run code to go to a location in the world.
     */
    useEffect(() => {
        determineMapBounds();
    }, [mapsIndoorsInstance, currentVenueName, locationId, kioskOriginLocationId, pitch, bearing, startZoomLevel, categories, center]);

    /**
     * Based on the combination of the states for venueName, locationId & kioskOriginLocationId,
     * determine where to make the map go to.
     */
    function determineMapBounds() {
        const currentVenue = venuesInSolution.find(venue => venue.name.toLowerCase() === currentVenueName.toLowerCase());
        let desktopPadBottom = null;
        let desktopPadLeft = null;
        let mobilePadBottom = null;

        if (mapsIndoorsInstance && currentVenue) {
            setMapPositionInvestigating(true);

            // Parse center prop into coordinates. If it is not included in the URL, latLng are undefined.
            const [latitude, longitude] = center
                ? center.split(",").map(Number)
                : [undefined, undefined];

            // Create centerPoint object.
            const centerPoint = { geometry: { type: 'Point', coordinates: [latitude, longitude] } };

            // Returns Venue that intersects with center prop.
            const intersectingVenueWithCenterPoint = venuesInSolution.find(venue => {
                return turf.booleanIntersects(venue.geometry, centerPoint.geometry);
            })

            // If startZoomLevel is not defined, fallback to 16 default value.
            const zoomLevel = startZoomLevel ?? 18;

            Promise.all([getDesktopPaddingBottom(), getDesktopPaddingLeft(), getMobilePaddingBottom()]).then(([desktopPaddingBottom, desktopPaddingLeft, mobilePaddingBottom]) => {
                desktopPadBottom = desktopPaddingBottom;
                mobilePadBottom = mobilePaddingBottom
                desktopPadLeft = desktopPaddingLeft;
            });

            if (kioskOriginLocationId && isDesktop) {
                if (!isNullOrUndefined(center)) {
                    // When in Kiosk mode and center prop is defined, set centerPoint to be center prop.
                    setMapPositionKnown(centerPoint.geometry);
                    goTo(centerPoint.geometry, mapsIndoorsInstance, desktopPadBottom, 0, zoomLevel, currentPitch, bearing);
                } else {
                    // When in Kiosk mode (which can only happen on desktop), the map is fitted to the bounds of the given Location with some bottom padding to accommodate
                    // for the bottom-centered modal.
                    window.mapsindoors.services.LocationsService.getLocation(kioskOriginLocationId).then(kioskLocation => {
                        if (kioskLocation) {
                            // Set the floor to the one that the Location belongs to.
                            const locationFloor = kioskLocation.properties.floor;
                            mapsIndoorsInstance.setFloor(locationFloor);
                            setKioskDisplayRule(kioskLocation);

                            setMapPositionKnown(kioskLocation.geometry);
                            goTo(kioskLocation.geometry, mapsIndoorsInstance, desktopPadBottom, 0, zoomLevel, currentPitch, bearing);
                        }
                    });
                }
            } else if (locationId && !venueWasSelected) {
                if (!isNullOrUndefined(center)) {
                    // When locationId is defined and center prop is defined, set centerPoint to be center prop.
                    if (isDesktop) {
                        setMapPositionKnown(centerPoint.geometry);
                        goTo(centerPoint.geometry, mapsIndoorsInstance, 0, desktopPadLeft, zoomLevel, currentPitch, bearing);
                    } else {
                        setMapPositionKnown(centerPoint.geometry);
                        goTo(centerPoint.geometry, mapsIndoorsInstance, mobilePadBottom, 0, zoomLevel, currentPitch, bearing);
                    }
                } else {
                    // When a LocationID is set, the map is centered fitted to the bounds of the given Location with some padding,
                    // either bottom (on mobile to accommodate for the bottom sheet) or to the left (on desktop to accommodate for the modal).
                    window.mapsindoors.services.LocationsService.getLocation(locationId).then(location => {
                        if (location) {
                            // Set the floor to the one that the Location belongs to.
                            const locationFloor = location.properties.floor;
                            mapsIndoorsInstance.setFloor(locationFloor);

                            if (isDesktop) {
                                setMapPositionKnown(location.geometry);
                                goTo(location.geometry, mapsIndoorsInstance, 0, desktopPadLeft, zoomLevel, currentPitch, bearing);
                            } else {
                                setMapPositionKnown(location.geometry);
                                goTo(location.geometry, mapsIndoorsInstance, mobilePadBottom, 0, zoomLevel, currentPitch, bearing);
                            }
                        }
                    });
                }
            } else if (currentVenue) {
                if (venueWasSelected) {
                    // If switching Venues, while having center prop defined, set center prop to undefined.
                    // It is required to be able to switch between Venues inside Venue Selector.
                    center = undefined;
                    if (isDesktop) {
                        setMapPositionKnown(currentVenue.geometry);
                        goTo(currentVenue.geometry, mapsIndoorsInstance, 0, desktopPadLeft, zoomLevel, currentPitch, bearing);
                    } else {
                        setMapPositionKnown(currentVenue.geometry);
                        goTo(currentVenue.geometry, mapsIndoorsInstance, mobilePadBottom, 0, zoomLevel, currentPitch, bearing);
                    }
                } else {
                    if (isNullOrUndefined(center)) {
                        // If center prop is not defined, pan to currentVenue.
                        if (isDesktop) {
                            setMapPositionKnown(currentVenue.geometry);
                            goTo(currentVenue.geometry, mapsIndoorsInstance, 0, desktopPadLeft, zoomLevel, currentPitch, bearing);
                        } else {
                            setMapPositionKnown(currentVenue.geometry);
                            goTo(currentVenue.geometry, mapsIndoorsInstance, mobilePadBottom, 0, zoomLevel, currentPitch, bearing);
                        }
                    } else if (isNullOrUndefined(intersectingVenueWithCenterPoint)) {
                        // If center prop is defined, but it does not intersects with any Venue, pan to value that is defined by center prop.
                        if (isDesktop) {
                            setMapPositionKnown(centerPoint.geometry);
                            goTo(centerPoint.geometry, mapsIndoorsInstance, 0, desktopPadLeft, zoomLevel, currentPitch, bearing);
                        } else {
                            setMapPositionKnown(centerPoint.geometry);
                            goTo(centerPoint.geometry, mapsIndoorsInstance, mobilePadBottom, 0, zoomLevel, currentPitch, bearing);
                        }
                    } else {
                        // If center prop is defined and it does intersects with a Venue, pan to value that is defined by center prop and
                        // when map is ready, setCurrentVenueName to the Venue that center prop is intersecting with.
                        if (isDesktop) {
                            setMapPositionKnown(centerPoint.geometry);
                            goTo(centerPoint.geometry, mapsIndoorsInstance, 0, desktopPadLeft, zoomLevel, currentPitch, bearing);
                        } else {
                            setMapPositionKnown(centerPoint.geometry);
                            goTo(centerPoint.geometry, mapsIndoorsInstance, mobilePadBottom, 0, zoomLevel, currentPitch, bearing);
                        }

                        if (isMapReady) {
                            setCurrentVenueName(intersectingVenueWithCenterPoint.name);
                        }
                    }
                }
            }
        }
    }

    /**
     * Override Display Rule for the Kiosk Location for better visibility.
     *
     * @param {object} kioskLocation
     */
    function setKioskDisplayRule(kioskLocation) {
        if (kioskLocationDisplayRuleWasChanged) return; // Don't set Display Rule more than once.

        const displayRule = mapsIndoorsInstance.getDisplayRule(kioskLocation);

        displayRule.visible = true;
        displayRule.iconSize = { width: displayRule.iconSize.width * 2, height: displayRule.iconSize.height * 2 };
        displayRule.iconVisible = true;
        displayRule.zoomFrom = 0;
        displayRule.zoomTo = 999;
        displayRule.clickable = false;
        mapsIndoorsInstance.setDisplayRule(kioskLocation.id, displayRule);

        setKioskLocationDisplayRuleWasChanged(true);
    }

    return [mapPositionInvestigating, mapPositionKnown];
};

export default useMapBoundsDeterminer;

/**
 * Make the map go to specified geometry with optional padding, zoom level, pitch and bearing.
 *
 * @param {object} geometry - GeoJSON geometry to make map bounds fit to.
 * @param {object} mapsIndoorsInstance - MapsIndoors instance.
 * @param {number} paddingBottom - Padding that should be applied to the bottom of the map.
 * @param {number} paddingLeft - Padding that should be applied to the left of the map.
 * @param {number} zoomLevel - Enforced zoom level.
 * @param {number} pitch - Map pitch (tilt).
 * @param {number} bearing - Mp bearing (rotation) in degrees from north.
 */
function goTo(geometry, mapsIndoorsInstance, paddingBottom, paddingLeft, zoomLevel, pitch, bearing) {
    mapsIndoorsInstance.getMapView().tilt(pitch || 0);
    mapsIndoorsInstance.getMapView().rotate(bearing || 0);
    mapsIndoorsInstance.goTo({ type: 'Feature', geometry, properties: {} }, {
        maxZoom: zoomLevel ?? 22,
        padding: { top: 0, right: 0, bottom: paddingBottom, left: paddingLeft },
    }).then(() => {
        if (zoomLevel) {
            mapsIndoorsInstance.setZoom(zoomLevel);
        }
    });
}

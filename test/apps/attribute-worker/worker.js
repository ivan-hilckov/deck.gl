/* global fetch */
import TEST_CASES from './test-cases';
import {LayerManager} from '@deck.gl/core';
import * as Layers from '@deck.gl/layers';

export default self => {
  self.onmessage = evt => {
    const testCase = TEST_CASES[evt.data.id];

    fetchJSON(testCase.data).then(data => {
      const LayerType = Layers[testCase.type];
      const {props, transferList} = getLayerSnapshot(new LayerType({...testCase, data}));
      self.postMessage(props, transferList);
    });
  };
};

function fetchJSON(url) {
  return fetch(url).then(resp => resp.json());
}

function getLayerSnapshot(layer) {
  const layerManager = new LayerManager();
  layerManager.setProps({layers: [layer]});
  layerManager.updateLayers();

  const props = {};
  let transferList = [];

  layerManager.layers.forEach(l => {
    const ids = [];
    let parentLayer = l.parent;
    let parentProps = props;

    while (parentLayer) {
      ids.push(getSublayerId(parentLayer));
      parentLayer = parentLayer.parent;
    }
    while (ids.length) {
      parentProps = parentProps[ids.pop()].subLayerProps;
    }

    if (l.isComposite) {
      parentProps[getSublayerId(l)] = getCompositeLayerSnapshot(l).props;
    } else {
      const snapshot = getPrimitiveLayerSnapshot(l);
      parentProps[getSublayerId(l)] = snapshot.props;
      transferList = transferList.concat(snapshot.transferList);
    }
  });

  // Release resources
  layerManager.setProps({layers: []});
  layerManager.updateLayers();
  layerManager.finalize();

  return {props: props[layer.id], transferList};
}

function getSublayerId(layer) {
  const id = layer.id;
  if (layer.parent) {
    const parentId = layer.parent && layer.parent.id;
    return id.slice(parentId.length + 1);
  }
  return id;
}

function getCompositeLayerSnapshot(layer) {
  return {
    props: {
      id: layer.id,
      type: layer.constructor.name,
      subLayerProps: {}
    }
  };
}

// Props used for attribute generation, can be safely discarded
const propBlackList = new Set(['data', 'updateTriggers']);

// Props inherited from parent
const sublayerPropBlackList = new Set([
  'fp64',
  'lightSettings',
  'transitions',
  'opacity',
  'pickable',
  'visible',
  'parameters',
  'getPolygonOffset',
  'highlightedObjectIndex',
  'autoHighlight',
  'highlightColor',
  'coordinateSystem',
  'coordinateOrigin',
  'wrapLongitude',
  'modelMatrix'
]);

function getPrimitiveLayerSnapshot(layer) {
  // Extract generated attributes - should move to AttributeManager?
  const props = {};
  const transferList = [];
  const {attributeManager} = layer.state;
  const {attributes} = attributeManager;

  for (const attributeName in attributes) {
    const attribute = attributes[attributeName];

    if (!attribute.constant && ArrayBuffer.isView(attribute.value)) {
      props[attributeName] = attribute.value;
      transferList.push(attribute.value.buffer);
    }
  }

  for (const propName in layer.props) {
    if (
      Object.hasOwnProperty.call(layer.props, propName) &&
      !propBlackList.has(propName) &&
      (!layer.parent || !sublayerPropBlackList.has(propName)) &&
      typeof layer.props[propName] !== 'function'
    ) {
      props[propName] = layer.props[propName];
    }
  }

  props.type = layer.constructor.name;
  props.numInstances = layer.getNumInstances();
  if ('vertexCount' in layer.state) {
    props.vertexCount = layer.state.vertexCount;
  }

  return {props, transferList};
}
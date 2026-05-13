import { getNodesToHide, hideNodesBatch, showNodesBatch } from '../dom';

// Mock requestAnimationFrame
const mockRequestAnimationFrame = jest.fn((callback) => {
  setTimeout(callback, 0);
});

// 在全局范围内设置 requestAnimationFrame
global.requestAnimationFrame = mockRequestAnimationFrame;

describe('dom utils', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRequestAnimationFrame.mockClear();
  });

  describe.skip('getNodesToHide', () => {
    let parentElement: HTMLElement;
    let parentNode: HTMLElement;

    beforeEach(() => {
      // Create a mock DOM structure
      parentNode = document.createElement('div');
      parentElement = document.createElement('div');
      parentElement.setAttribute('data-comptype', 'test-type');
      parentNode.appendChild(parentElement);
    });

    it('should return empty array when parentDom has no parentNode', () => {
      const result = getNodesToHide(parentElement);

      expect(result).toEqual([]);
    });

    it('should return empty array when parentDom is null', () => {
      const result = getNodesToHide(null as any);

      expect(result).toEqual([]);
    });

    it('should return empty array when parentDom is undefined', () => {
      const result = getNodesToHide(undefined as any);

      expect(result).toEqual([]);
    });

    it.skip('should return siblings between current and next same type element', () => {
      // Create siblings
      const sibling1 = document.createElement('div');
      sibling1.setAttribute('data-comptype', 'other-type');
      const sibling2 = document.createElement('div');
      sibling2.setAttribute('data-comptype', 'other-type');
      const sibling3 = document.createElement('div');
      sibling3.setAttribute('data-comptype', 'test-type');
      const sibling4 = document.createElement('div');
      sibling4.setAttribute('data-comptype', 'other-type');

      parentNode.appendChild(sibling1);
      parentNode.appendChild(sibling2);
      parentNode.appendChild(sibling3);
      parentNode.appendChild(sibling4);

      const result = getNodesToHide(parentElement);

      expect(result).toEqual([sibling1, sibling2]);
    });

    it.skip('should return all siblings after current when no same type found', () => {
      // Create siblings without same type
      const sibling1 = document.createElement('div');
      sibling1.setAttribute('data-comptype', 'other-type');
      const sibling2 = document.createElement('div');
      sibling2.setAttribute('data-comptype', 'other-type');

      parentNode.appendChild(sibling1);
      parentNode.appendChild(sibling2);

      const result = getNodesToHide(parentElement);

      expect(result).toEqual([sibling1, sibling2]);
    });

    it('should return empty array when no siblings after current', () => {
      const result = getNodesToHide(parentElement);

      expect(result).toEqual([]);
    });

    it.skip('should handle case when next same type is immediately after current', () => {
      const sibling1 = document.createElement('div');
      sibling1.setAttribute('data-comptype', 'test-type');

      parentNode.appendChild(sibling1);

      const result = getNodesToHide(parentElement);

      expect(result).toEqual([]);
    });
  });

  describe.skip('hideNodesBatch', () => {
    let mockNodes: HTMLElement[];

    beforeEach(() => {
      mockNodes = Array.from({ length: 5 }, () => {
        const element = document.createElement('div');
        element.style.display = 'block';
        return element;
      });
    });

    it('should hide all nodes with default batch size', async () => {
      hideNodesBatch(mockNodes);

      // Wait for requestAnimationFrame to complete
      await new Promise((resolve) => setTimeout(resolve, 10));

      mockNodes.forEach((node) => {
        expect(node.style.display).toBe('none');
      });
    });

    it('should hide nodes with custom batch size', async () => {
      hideNodesBatch(mockNodes, 2);

      // Wait for requestAnimationFrame to complete
      await new Promise((resolve) => setTimeout(resolve, 0));

      mockNodes.forEach((node) => {
        expect(node.style.display).toBe('none');
      });
    });

    it('should handle empty array', () => {
      expect(() => hideNodesBatch([])).not.toThrow();
    });

    it.skip('should handle single node', async () => {
      const singleNode = [document.createElement('div')];
      singleNode[0].style.display = 'block';

      hideNodesBatch(singleNode);

      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(singleNode[0].style.display).toBe('none');
    });

    it('should use requestAnimationFrame for batching', () => {
      hideNodesBatch(mockNodes, 2);

      expect(mockRequestAnimationFrame).toHaveBeenCalled();
    });
  });

  describe.skip('showNodesBatch', () => {
    let mockNodes: HTMLElement[];

    beforeEach(() => {
      mockNodes = Array.from({ length: 5 }, () => {
        const element = document.createElement('div');
        element.style.display = 'none';
        return element;
      });
    });

    it('should show all nodes with default batch size', async () => {
      showNodesBatch(mockNodes);

      // Wait for requestAnimationFrame to complete
      await new Promise((resolve) => setTimeout(resolve, 0));

      mockNodes.forEach((node) => {
        expect(node.style.display).toBe('block');
      });
    });

    it('should show nodes with custom batch size', async () => {
      showNodesBatch(mockNodes, 2);

      // Wait for requestAnimationFrame to complete
      await new Promise((resolve) => setTimeout(resolve, 0));

      mockNodes.forEach((node) => {
        expect(node.style.display).toBe('block');
      });
    });

    it('should handle empty array', () => {
      expect(() => showNodesBatch([])).not.toThrow();
    });

    it.skip('should handle single node', async () => {
      const singleNode = [document.createElement('div')];
      singleNode[0].style.display = 'none';

      showNodesBatch(singleNode);

      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(singleNode[0].style.display).toBe('block');
    });

    it('should use requestAnimationFrame for batching', () => {
      showNodesBatch(mockNodes, 2);

      expect(mockRequestAnimationFrame).toHaveBeenCalled();
    });
  });
});

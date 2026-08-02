import { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing } from 'react-native';

/**
 * Press feedback for cards and buttons: a 2% dip, fast in, slower out.
 *
 * Motion is deliberately the only animation on a card — the content is dense
 * enough. Honours the OS reduce-motion setting, in which case the scale simply
 * never moves.
 */
export function usePressScale(depth = 0.98) {
  const scale = useRef(new Animated.Value(1)).current;
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let alive = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (alive) setReduceMotion(enabled);
    });
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => {
      alive = false;
      subscription.remove();
    };
  }, []);

  const animate = useCallback(
    (toValue: number, duration: number) => {
      if (reduceMotion) return;
      Animated.timing(scale, {
        toValue,
        duration,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }).start();
    },
    [reduceMotion, scale],
  );

  return {
    scale,
    onPressIn: useCallback(() => animate(depth, 90), [animate, depth]),
    onPressOut: useCallback(() => animate(1, 160), [animate]),
  };
}

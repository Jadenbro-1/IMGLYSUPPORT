import React, {
  useState,
  useContext,
  useEffect,
  useRef,
  useCallback,
} from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  TextInput,
  Image,
  SafeAreaView,
  Alert,
  ActivityIndicator,
  Dimensions,
  Platform,
  ScrollView,
  Animated,
  Easing,
  KeyboardAvoidingView,
  Keyboard,
  findNodeHandle
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { launchImageLibrary } from 'react-native-image-picker';
import axios from 'axios';
import debounce from 'lodash/debounce';
import { UserContext } from './UserContext';
import { UploadContext } from './UploadContext';
import { createThumbnail } from 'react-native-create-thumbnail';
import RNFS from 'react-native-fs';
import Video from 'react-native-video';
import { FFmpegKit, ReturnCode } from 'ffmpeg-kit-react-native';

// Assets
const BackIcon = require('../assets/left.png');
const PlusIcon = require('../assets/plus.png');
const CloseIcon = require('../assets/x.png');
const CameraIcon = require('../assets/camera.png');
const CheckIcon = require('../assets/check5.png');

const { width: windowWidth, height: windowHeight } = Dimensions.get('window');

// USDA (or FDA) API Key (yours)
const USDA_API_KEY = '7ropkhW0gWpmkjVuz6ZI0oKDixZS1bYI75W1z7qV';

// Available units
const metrics = [
  'pcs','piece','cup','teaspoon','tablespoon','gram','milligram','kilogram','ounce','pound',
  'liter','milliliter','clove','slice','can','bunch','pack','stick','strip','pinch','dash',
  'jar','bottle','head','container','bag','carton','ear','fillet','chunk','unit','sprig','packet',
  'rib','loaf','stalk','cupful','gill','barrel','quart','pint','gallon','fluid ounce','dry ounce',
  'fluid dram','imperial cup','imperial pint','imperial quart','imperial gallon','kiloliter','centiliter'
];

const categoryItemsData = [
  { label: 'Select Category', value: '' },
  { label: 'Breakfast', value: 'Breakfast' },
  { label: 'Lunch', value: 'Lunch' },
  { label: 'Dinner', value: 'Dinner' },
  { label: 'Snack', value: 'Snack' },
  { label: 'Dessert', value: 'Dessert' },
  { label: 'Appetizer', value: 'Appetizer' },
  { label: 'Beverage', value: 'Beverage' },
];

const cuisineItemsData = [
  { label: 'Select Cuisine', value: '' },
  { label: 'Italian', value: 'Italian' },
  { label: 'Chinese', value: 'Chinese' },
  { label: 'Indian', value: 'Indian' },
  { label: 'American', value: 'American' },
  { label: 'Mexican', value: 'Mexican' },
  { label: 'French', value: 'French' },
  { label: 'Japanese', value: 'Japanese' },
];

// Character limits
const DISH_NAME_MAX_CHARS = 50;
const DESCRIPTION_MAX_CHARS = 200;
const STEP_MAX_CHARS = 100;
const TAG_MAX_LENGTH = 10;
const DIET_TAG_MAX_LENGTH = 10;

// Thumbnail constants
export const FRAME_PER_SEC = 1;
const TILE_HEIGHT = 80;
const TILE_WIDTH = 40;
const DURATION_WINDOW_DURATION = 1;
const DURATION_WINDOW_BORDER_WIDTH = 4;
const DURATION_WINDOW_WIDTH = DURATION_WINDOW_DURATION * FRAME_PER_SEC * TILE_WIDTH;
const POPLINE_POSITION = '50%';

// Frame states
const FRAME_STATUS = Object.freeze({
  LOADING: { name: Symbol('LOADING') },
  READY: { name: Symbol('READY') },
});

// FFmpeg helper
class FFmpegWrapper {
  static getFrames(localFileName, videoURI, frameNumber, successCallback, errorCallback) {
    const outputImagePath = `${RNFS.CachesDirectoryPath}/${localFileName}_%4d.png`;
    // For iOS/Android
    const cmd = `-ss 0 -i ${videoURI} -vf "fps=${FRAME_PER_SEC}/1:round=up" -vframes ${frameNumber} ${outputImagePath}`;
    FFmpegKit.executeAsync(
      cmd,
      async session => {
        const returnCode = await session.getReturnCode();
        if (ReturnCode.isSuccess(returnCode)) {
          successCallback(outputImagePath);
        } else {
          if (errorCallback) errorCallback();
        }
      }
    );
  }
}

// Utility
const getFileNameFromPath = path => {
  const fragments = path.split('/');
  return fragments[fragments.length - 1].split('.')[0];
};
const getPopLinePlayTime = offset => {
  return (
    (offset + (DURATION_WINDOW_WIDTH * parseFloat(POPLINE_POSITION)) / 100) /
    (FRAME_PER_SEC * TILE_WIDTH)
  );
};
const removeNewlines = (text) => text.replace(/\n/g, '');

const PostUpload = () => {
  const navigation = useNavigation();
  const route = useRoute();
  const { currentUser } = useContext(UserContext);

  const {
    setIsUploading: setGlobalIsUploading,
    setUploadProgress: setGlobalUploadProgress,
    setUploadThumbnail,
  } = useContext(UploadContext);

  const scrollViewRef = useRef(null);

  // Guard if not logged in
  if (!currentUser || !currentUser.id) {
    Alert.alert('Authentication Required', 'Please log in to upload a recipe.', [
      { text: 'Go to Login', onPress: () => navigation.navigate('Login') },
    ]);
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.authContainer}>
          <Text style={styles.authText}>You must be logged in to upload a recipe.</Text>
          <TouchableOpacity
            style={styles.authButton}
            onPress={() => navigation.navigate('Login')}
          >
            <Text style={styles.authButtonText}>Go to Login</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // Route props
  const { editedMedia = [] } = route.params || {};

  // Form data
  const [dishName, setDishName] = useState('');
  const [description, setDescription] = useState('');
  const [ingredients, setIngredients] = useState([
    { name: '', quantity: '', unit: '', unitLocked: false }
  ]);
  const [steps, setSteps] = useState(['']);
  const [tags, setTags] = useState([]);
  const [dietaryTags, setDietaryTags] = useState([]);
  const [tagInput, setTagInput] = useState('');
  const [dietTagInput, setDietTagInput] = useState('');
  const [videoUri, setVideoUri] = useState(editedMedia[0]?.uri || null);
  const [thumbnailUri, setThumbnailUri] = useState(null);
  const [initialThumbnailUri, setInitialThumbnailUri] = useState(null);
  const [dishImageUri, setDishImageUri] = useState(null);

  // Extended info
  const [prepTime, setPrepTime] = useState('');
  const [cookTime, setCookTime] = useState('');
  const [yields, setYields] = useState('');
  const [categoryValue, setCategoryValue] = useState('');
  const [categoryLocked, setCategoryLocked] = useState(false);
  const [cuisineValue, setCuisineValue] = useState('');
  const [cuisineLocked, setCuisineLocked] = useState(false);

  // Uploading states
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  // Thumbnails
  const [frames, setFrames] = useState(null);
  const [isGeneratingFrames, setIsGeneratingFrames] = useState(false);
  const [currentFrameIndex, setCurrentFrameIndex] = useState(0);
  const videoPlayerRef = useRef();
  const [showFrames, setShowFrames] = useState(false);

  // Animations
  const [scrollEnabled, setScrollEnabled] = useState(true);
  const formOpacity = useRef(new Animated.Value(0)).current;
  const [iconsAnim] = useState(new Animated.Value(0));
  const [framesAnim] = useState(new Animated.Value(0));

  // NEW: Real-time suggestions
  const [ingredientSuggestions, setIngredientSuggestions] = useState([]);
  const [isFetchingSuggestions, setIsFetchingSuggestions] = useState(false);
  const [activeIngredientIndex, setActiveIngredientIndex] = useState(null);

  // Refs
  const dishNameRef = useRef(null);
  const descriptionRef = useRef(null);
  const prepRef = useRef(null);
  const cookRef = useRef(null);
  const yieldRef = useRef(null);
  const ingredientRefs = useRef([]);
  const stepRefs = useRef([]);
  const tagRef = useRef(null);
  const dietRef = useRef(null);
  const unitWidthRefs = useRef([]); // animate ingredient unit selection

  // Debounce USDA lookups
  const fetchIngredientSuggestions = async (query) => {
    if (!query || query.length < 3) {
      setIngredientSuggestions([]);
      return;
    }
    try {
      setIsFetchingSuggestions(true);
      const url = `https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${USDA_API_KEY}&query=${encodeURIComponent(query)}&pageSize=10`;
      const response = await axios.get(url);
      if (response.data && response.data.foods) {
        setIngredientSuggestions(response.data.foods);
      } else {
        setIngredientSuggestions([]);
      }
    } catch (error) {
      console.error('Error fetching suggestions:', error);
      setIngredientSuggestions([]);
    } finally {
      setIsFetchingSuggestions(false);
    }
  };
  const debouncedFetchIngredientSuggestions = useCallback(
    debounce((text) => {
      fetchIngredientSuggestions(text);
    }, 400),
    []
  );

  // generate initial thumbnail on mount
  useEffect(() => {
    if (!videoUri) return;
    (async () => {
      try {
        const response = await createThumbnail({ url: videoUri, timeStamp: 0 });
        if (response?.path) {
          setThumbnailUri(response.path);
          setInitialThumbnailUri(response.path);
        }
      } catch (err) {
        console.warn('Error generating initial thumbnail:', err);
      }
    })();
  }, [videoUri]);

  // animate show/hide frames
  useEffect(() => {
    if (!showFrames) {
      Animated.timing(formOpacity, {
        toValue: 1,
        duration: 500,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: true,
      }).start();
      iconsAnim.setValue(0);
    } else {
      formOpacity.setValue(0);
      Animated.timing(iconsAnim, {
        toValue: 1,
        duration: 300,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: true,
      }).start();
    }
  }, [showFrames]);

  // measure & scroll
  const scrollToInput = (ref) => {
    if (ref?.current && scrollViewRef.current) {
      ref.current.measureLayout(
        findNodeHandle(scrollViewRef.current),
        (x, y) => {
          scrollViewRef.current.scrollTo({ y: y - 100, animated: true });
        },
        () => {}
      );
    }
  };

  // timeline scroll
  const handleOnScroll = ({ nativeEvent }) => {
    const playbackTime = getPopLinePlayTime(nativeEvent.contentOffset.x);
    if (videoPlayerRef.current) {
      videoPlayerRef.current.seek(playbackTime);
    }
    if (frames && frames.length > 0) {
      let index = Math.floor(playbackTime);
      if (index < 0) index = 0;
      if (index >= frames.length) index = frames.length - 1;
      setCurrentFrameIndex(index);
    }
  };

  // video load => generate frames
  const handleVideoLoad = (videoInfo) => {
    if (!videoUri) return;
    const numberOfFrames = Math.ceil(videoInfo.duration);
    setIsGeneratingFrames(true);
    setFrames(Array(numberOfFrames).fill({ status: FRAME_STATUS.LOADING.name.description }));
    FFmpegWrapper.getFrames(
      getFileNameFromPath(videoUri),
      videoUri,
      numberOfFrames,
      (filePath) => {
        const resultFrames = [];
        for (let i = 0; i < numberOfFrames; i++) {
          resultFrames.push({ 
            uri: filePath.replace('%4d', String(i + 1).padStart(4, '0')), 
            status: FRAME_STATUS.READY.name.description 
          });
        }
        setFrames(resultFrames);
        setIsGeneratingFrames(false);
      },
      () => {
        Alert.alert('Error', 'Failed to generate frames.');
        setIsGeneratingFrames(false);
      }
    );
  };

  const renderFrame = (frame, i) => {
    if (frame.status === FRAME_STATUS.LOADING.name.description) {
      return (
        <View key={i} style={styles.loadingFrame} />
      );
    }
    return (
      <Image
        key={i}
        source={{ uri: 'file://' + frame.uri }}
        style={{ width: TILE_WIDTH, height: TILE_HEIGHT }}
        resizeMode="cover"
      />
    );
  };
// Which ingredient rows have "Show More" active
const [showMoreIndices, setShowMoreIndices] = useState([]);

// Handler to mark a particular row as "show more"
const handleShowMore = (rowIndex) => {
  setShowMoreIndices((prev) => [...prev, rowIndex]);
};

  const currentFrameUri = frames?.[currentFrameIndex]?.uri
    ? 'file://' + frames[currentFrameIndex].uri
    : null;

  // cover selection
  const enterFrameSelection = () => {
    setShowFrames(true);
    setScrollEnabled(false);
  };
  const handleFinishFrameSelection = () => {
    if (currentFrameUri) setThumbnailUri(currentFrameUri);
    else if (initialThumbnailUri) setThumbnailUri(initialThumbnailUri);
    setShowFrames(false);
    setScrollEnabled(true);
  };
  const handleSelectCustomThumbnail = async () => {
    try {
      const result = await launchImageLibrary({ mediaType: 'photo' });
      if (result.assets?.length > 0) {
        setThumbnailUri(result.assets[0].uri);
      }
    } catch (err) {
      Alert.alert('Error', 'Error selecting thumbnail');
    }
  };
// Checks if the user's typed ingredientName exactly matches any returned suggestion
const isSuggestionMatch = (ingredientName, suggestions) => {
  return suggestions.some(
    (item) => item.description.toLowerCase() === ingredientName.toLowerCase()
  );
};

  // dish image
  const handleAddDishImage = async () => {
    try {
      const result = await launchImageLibrary({ mediaType: 'photo' });
      if (result.assets?.length > 0) {
        const { width, height } = result.assets[0];
        if (width > height) {
          setDishImageUri(result.assets[0].uri);
        } else {
          Alert.alert('Invalid Image', 'Please select a landscape image (width > height).');
        }
      }
    } catch (err) {
      Alert.alert('Error', 'Error selecting dish image');
    }
  };
  const handleEditDishImage = handleAddDishImage;

  // cloud
  const getCloudinarySignature = async (folder) => {
    try {
      const resp = await axios.get(
        `https://fresh-ios-c3a9e8c545dd.herokuapp.com/api/cloudinarySignature?folder=${folder}`
      );
      return resp.data;
    } catch (error) {
      console.error('Error fetching Cloudinary signature:', error.message);
      throw new Error('Failed to fetch signature');
    }
  };
  const uploadToCloudinary = async (uri, type, name, resourceType='auto', folder='') => {
    const { signature, timestamp, upload_preset } = await getCloudinarySignature(folder);
    const data = new FormData();
    data.append('file', {
      uri: Platform.OS === 'ios' ? uri : uri.replace('file://', ''),
      type,
      name,
    });
    data.append('api_key', '748823891644137');
    data.append('timestamp', timestamp);
    data.append('signature', signature);
    data.append('upload_preset', upload_preset);
    if (folder) data.append('folder', folder);

    const uploadUrl = `https://api.cloudinary.com/v1_1/dopzwjkox/${resourceType}/upload`;

    const cloudRes = await axios.post(uploadUrl, data, {
      headers: { 'Content-Type': 'multipart/form-data' },
      onUploadProgress: (evt) => {
        const progress = Math.round((evt.loaded * 100) / evt.total);
        setUploadProgress(progress);
        setGlobalUploadProgress(progress);
      },
    });
    return cloudRes.data.secure_url;
  };

  // share
  const handleShare = async () => {
    if (
      !dishName || !description ||
      ingredients.some(i => !i.name || !i.quantity || !i.unit) ||
      steps.length === 0 || !dishImageUri ||
      !prepTime || !cookTime || !categoryValue || !cuisineValue || !yields
    ) {
      Alert.alert('Error', 'Please fill all required fields');
      return;
    }
    // start
    setIsUploading(true);
    setGlobalIsUploading(true);
    setUploadProgress(0);
    setGlobalUploadProgress(0);

    // show "uploading" overlay in Home
    if (thumbnailUri) setUploadThumbnail(thumbnailUri);
    else if (dishImageUri) setUploadThumbnail(dishImageUri);

    // navigate to Home so user sees progress
    navigation.navigate('Home');

    try {
      const apiUrl = 'https://fresh-ios-c3a9e8c545dd.herokuapp.com';
      let videoUrl = null;
      if (videoUri) {
        videoUrl = await uploadToCloudinary(
          videoUri, 'video/mp4', 'videoUpload.mp4', 'video', 'videos'
        );
      }
      let thumbnailUrl = null;
      if (thumbnailUri) {
        thumbnailUrl = await uploadToCloudinary(
          thumbnailUri, 'image/jpeg', 'thumbnail.jpg', 'image', 'video-thumbnails'
        );
      }
      const dishImageUrl = await uploadToCloudinary(
        dishImageUri, 'image/jpeg', 'dishImage.jpg', 'image', 'recipe-image'
      );

      const recipeData = {
        title: dishName,
        description,
        prep_time: parseFloat(prepTime),
        cook_time: parseFloat(cookTime),
        ingredients: JSON.stringify(ingredients),
        instructions: JSON.stringify(steps),
        category: categoryValue,
        cuisine: cuisineValue,
        imageUri: dishImageUrl,
        videoUri: videoUrl,
        userId: currentUser.id,
        tags: tags.join(','),
        dietaryTags: dietaryTags.join(','),
        thumbnailUri: thumbnailUrl,
        yields,
      };

      await axios.post(`${apiUrl}/api/upload`, recipeData, {
        headers: { 'Content-Type': 'application/json' },
      });

      resetForm();
      navigation.navigate('Home');
    } catch (error) {
      console.error('Upload error:', error.response?.data || error.message);
      Alert.alert('Error', 'Failed to share the recipe. Please try again.');
    } finally {
      setIsUploading(false);
      setGlobalIsUploading(false);
      setUploadProgress(0);
      setGlobalUploadProgress(0);
    }
  };

  // reset
  const resetForm = () => {
    setVideoUri(null);
    setThumbnailUri(null);
    setInitialThumbnailUri(null);
    setDishImageUri(null);
    setDishName('');
    setDescription('');
    setIngredients([{ name: '', quantity: '', unit: '', unitLocked: false }]);
    setSteps(['']);
    setTags([]);
    setDietaryTags([]);
    setTagInput('');
    setDietTagInput('');
    setPrepTime('');
    setCookTime('');
    setCategoryValue('');
    setCuisineValue('');
    setCategoryLocked(false);
    setCuisineLocked(false);
    setYields('');
    setFrames(null);
    setShowFrames(false);
    setCurrentFrameIndex(0);
    iconsAnim.setValue(0);
    framesAnim.setValue(0);
  };

  // back nav
  const handleBackPress = () => {
    if (showFrames) {
      if (!currentFrameUri && initialThumbnailUri) {
        setThumbnailUri(initialThumbnailUri);
      }
      setShowFrames(false);
      setScrollEnabled(true);
    } else {
      navigation.goBack();
    }
  };

  // ingredient unit transitions
  useEffect(() => {
    ingredients.forEach((_, i) => {
      if (!unitWidthRefs.current[i]) {
        unitWidthRefs.current[i] = new Animated.Value(0);
      }
    });
    ingredients.forEach((ing, i) => {
      Animated.timing(unitWidthRefs.current[i], {
        toValue: ing.unitLocked && ing.unit ? 80 : 265,
        duration: 300,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: false,
      }).start();
    });
  }, [ingredients]);

  // add/remove
  const addIngredient = () => {
    const newIngredients = [
      ...ingredients,
      { name: '', quantity: '', unit: '', unitLocked: false }
    ];
    setIngredients(newIngredients);
    setTimeout(() => {
      const idx = newIngredients.length - 1;
      if (ingredientRefs.current[idx * 2]) {
        ingredientRefs.current[idx * 2].focus();
      }
      scrollToInput({ current: ingredientRefs.current[idx * 2] });
    }, 100);
  };
  const removeIngredient = (i) => {
    const newIngs = ingredients.filter((_, idx) => idx !== i);
    setIngredients(newIngs);
    setIngredientSuggestions([]);
  };
  const addStep = () => {
    const newSteps = [...steps, ''];
    setSteps(newSteps);
    setTimeout(() => {
      const idx = newSteps.length - 1;
      if (stepRefs.current[idx]) stepRefs.current[idx].focus();
      scrollToInput({ current: stepRefs.current[idx] });
    }, 100);
  };
  const removeStep = (i) => {
    setSteps(steps.filter((_, idx) => idx !== i));
  };

  // tags
  const handleAddTag = () => {
    const trimmed = tagInput.trim();
    if (trimmed && tags.length < TAG_MAX_LENGTH) {
      setTags([...tags, '#' + trimmed.replace(/\s+/g, '-')]);
    }
    setTagInput('');
  };
  const handleAddDietTag = () => {
    const trimmed = dietTagInput.trim();
    if (trimmed && dietaryTags.length < DIET_TAG_MAX_LENGTH) {
      setDietaryTags([...dietaryTags, '#' + trimmed.replace(/\s+/g, '-')]);
    }
    setDietTagInput('');
  };
  const renderTags = (tagsArr, setArr) => (
    <View style={styles.tagsContainer}>
      {tagsArr.map((t, i) => (
        <TouchableOpacity
          key={`${t}-${i}`}
          onPress={() => {
            const newArr = [...tagsArr];
            newArr.splice(i, 1);
            setArr(newArr);
          }}
          style={styles.tagChip}
        >
          <Text style={styles.tagText}>{t}</Text>
          <TouchableOpacity
            onPress={(e) => {
              e.stopPropagation();
              const newArr = [...tagsArr];
              newArr.splice(i, 1);
              setArr(newArr);
            }}
          >
            <Image source={CloseIcon} style={styles.tagCloseIcon} />
          </TouchableOpacity>
        </TouchableOpacity>
      ))}
    </View>
  );

  // word count circle
  const WordCountCircle = ({ maxChars, text }) => {
    const used = (text?.length) || 0;
    const left = maxChars - used;
    const color = left < 0 ? 'rgba(255,0,0,0.6)' : 'rgba(144,238,144,0.6)';
    return (
      <View style={[styles.wordCountCircle, { borderColor: color }]}>
        <Text style={{ color, fontSize: 11 }}>{left}</Text>
      </View>
    );
  };

  const conditionalProps = (multiline, onSubmitEditing) => {
    if (!multiline) return {};
    return {
      blurOnSubmit: false,
      onKeyPress: ({ nativeEvent }) => {
        if (nativeEvent.key === 'Enter' && onSubmitEditing) onSubmitEditing();
      }
    };
  };

  // simplified reuse
  const renderInput = ({
    label, placeholder, value, onChangeText, reference, onSubmitEditing,
    maxChars, keyboardType='default', multiline=false, scrollAfterFocus=true
  }) => {
    const handleFocus = () => {
      if (scrollAfterFocus) {
        setTimeout(() => { scrollToInput(reference); }, 50);
      }
    };
    return (
      <View style={{ marginBottom: 20 }}>
        {label ? <Text style={styles.inputLabel}>{label}</Text> : null}
        <View style={styles.inputContainer}>
          <View style={styles.inputRow}>
            <TextInput
              ref={reference}
              placeholder={placeholder}
              placeholderTextColor="#888"
              value={value}
              onChangeText={(txt) => onChangeText(removeNewlines(txt))}
              style={[styles.input, { flex: 1, paddingRight: 50 }]}
              editable={!isUploading}
              returnKeyType="next"
              onSubmitEditing={onSubmitEditing}
              blurOnSubmit={!multiline}
              keyboardType={keyboardType}
              multiline={multiline}
              onFocus={handleFocus}
              {...conditionalProps(multiline, onSubmitEditing)}
            />
            {typeof maxChars === 'number' && (
              <View style={styles.wordCountWrapper}>
                <WordCountCircle maxChars={maxChars} text={value} />
              </View>
            )}
          </View>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={handleBackPress} style={styles.backButton} disabled={isUploading}>
          <Image source={BackIcon} style={[styles.headerIcon, { tintColor: '#ccc' }]} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>New Recipe</Text>
      </View>

      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <ScrollView
          ref={scrollViewRef}
          contentContainerStyle={styles.scrollContainer}
          scrollEnabled={scrollEnabled}
        >
          {/* Thumbnail Preview */}
          <View style={styles.thumbnailContainer}>
            {currentFrameUri ? (
              <Image source={{ uri: currentFrameUri }} style={styles.thumbnailOverlay} />
            ) : thumbnailUri ? (
              <Image source={{ uri: thumbnailUri }} style={styles.thumbnailOverlay} />
            ) : (
              <View style={styles.loadingThumbnailContainer}>
                <ActivityIndicator size="large" color="#888" />
              </View>
            )}
            {!showFrames && (
              <TouchableOpacity
                onPress={enterFrameSelection}
                disabled={!thumbnailUri || isUploading}
                style={styles.editCoverButton}
              >
                <Text style={styles.editCoverText}>Edit Cover</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Frame Selection */}
          {showFrames ? (
            <>
              <View style={{ marginTop: 20, alignItems: 'center' }}>
                <Text style={{ color: '#ccc', fontSize: 18, fontWeight: '600', marginBottom: 20 }}>
                  Choose Your Cover
                </Text>
              </View>

              <Animated.View style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'center' }}>
                <TouchableOpacity
                  style={styles.framesPlusContainer}
                  onPress={handleSelectCustomThumbnail}
                  disabled={isUploading}
                >
                  <Image source={PlusIcon} style={styles.iconInside} />
                </TouchableOpacity>

                <Animated.View style={[styles.framesContainer, { width: windowWidth - 200 }]}>
                  <View style={{ width: 0, height: 0 }}>
                    <Video
                      ref={videoPlayerRef}
                      style={{ width: 0, height: 0 }}
                      source={{ uri: videoUri }}
                      paused
                      onLoad={handleVideoLoad}
                    />
                  </View>

                  {isGeneratingFrames && (
                    <View style={styles.loadingIndicatorContainer}>
                      <ActivityIndicator size="large" color="#1DA1F2" />
                      <Text style={{ color: '#fff', marginTop: 10 }}>Generating frames...</Text>
                    </View>
                  )}

                  {frames && (
                    <View style={styles.durationWindowAndFramesLineContainer}>
                      <View style={styles.durationWindow}>
                        {currentFrameUri && (
                          <Image
                            source={{ uri: currentFrameUri }}
                            style={styles.currentFrameImage}
                            resizeMode="cover"
                          />
                        )}
                      </View>

                      <ScrollView
                        horizontal
                        showsHorizontalScrollIndicator={false}
                        bounces={false}
                        scrollEventThrottle={1}
                        onScroll={handleOnScroll}
                        contentContainerStyle={{
                          paddingLeft: windowWidth / 2 - TILE_WIDTH / 0.37,
                          paddingRight: windowWidth / 2 - TILE_WIDTH / 0.37,
                        }}
                      >
                        {frames.map((frame, idx) => renderFrame(frame, idx))}
                      </ScrollView>
                    </View>
                  )}
                </Animated.View>

                <TouchableOpacity
                  style={styles.checkButtonContainer}
                  onPress={handleFinishFrameSelection}
                  disabled={isUploading}
                >
                  <Image source={CheckIcon} style={styles.iconInside} />
                </TouchableOpacity>
              </Animated.View>
            </>
          ) : (
            // Main Form
            <Animated.View style={{ opacity: formOpacity }}>
              {/* Basic Info */}
              <View style={styles.formSection}>
                <Text style={styles.sectionTitle}>Basic Info</Text>
                {renderInput({
                  label: 'Dish Name',
                  placeholder: 'Enter dish name',
                  value: dishName,
                  onChangeText: setDishName,
                  reference: dishNameRef,
                  onSubmitEditing: () => descriptionRef.current?.focus(),
                  maxChars: DISH_NAME_MAX_CHARS,
                  multiline: true
                })}
                {renderInput({
                  label: 'Description',
                  placeholder: 'Describe your dish',
                  value: description,
                  onChangeText: setDescription,
                  reference: descriptionRef,
                  onSubmitEditing: () => prepRef.current?.focus(),
                  maxChars: DESCRIPTION_MAX_CHARS,
                  multiline: true
                })}
                {renderInput({
                  label: 'Prep Time (minutes)',
                  placeholder: 'e.g. 10',
                  value: prepTime,
                  onChangeText: setPrepTime,
                  reference: prepRef,
                  onSubmitEditing: () => cookRef.current?.focus(),
                  keyboardType: 'numeric'
                })}
                {renderInput({
                  label: 'Cook Time (minutes)',
                  placeholder: 'e.g. 20',
                  value: cookTime,
                  onChangeText: setCookTime,
                  reference: cookRef,
                  onSubmitEditing: () => yieldRef.current?.focus(),
                  keyboardType: 'numeric'
                })}
                {renderInput({
                  label: 'Yields (Serves how many?)',
                  placeholder: 'e.g. 4',
                  value: yields,
                  onChangeText: setYields,
                  reference: yieldRef,
                  keyboardType: 'numeric'
                })}

                {/* Category */}
                <Text style={styles.inputLabel}>Category</Text>
                <View style={{ marginBottom: 20 }}>
                  {categoryLocked && categoryValue ? (
                    <TouchableOpacity
                      style={styles.lockedCategoryContainer}
                      onPress={() => setCategoryLocked(false)}
                    >
                      <Text style={styles.lockedCategoryText}>
                        {categoryItemsData.find(item => item.value === categoryValue)?.label}
                      </Text>
                    </TouchableOpacity>
                  ) : (
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ maxHeight: 50 }}>
                      {categoryItemsData.map(item => (
                        <TouchableOpacity
                          key={item.value}
                          onPress={() => {
                            setCategoryValue(item.value);
                            if (item.value) setCategoryLocked(true);
                          }}
                          style={[
                            styles.categoryChip,
                            categoryValue === item.value && { backgroundColor: 'rgba(29,161,242,0.3)' }
                          ]}
                        >
                          <Text style={styles.categoryChipText}>{item.label}</Text>
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                  )}
                </View>

                {/* Cuisine */}
                <Text style={styles.inputLabel}>Cuisine</Text>
                <View style={{ marginBottom: 20 }}>
                  {cuisineLocked && cuisineValue ? (
                    <TouchableOpacity
                      style={styles.lockedCategoryContainer}
                      onPress={() => setCuisineLocked(false)}
                    >
                      <Text style={styles.lockedCategoryText}>
                        {cuisineItemsData.find(item => item.value === cuisineValue)?.label}
                      </Text>
                    </TouchableOpacity>
                  ) : (
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ maxHeight: 50 }}>
                      {cuisineItemsData.map(item => (
                        <TouchableOpacity
                          key={item.value}
                          onPress={() => {
                            setCuisineValue(item.value);
                            if (item.value) setCuisineLocked(true);
                          }}
                          style={[
                            styles.categoryChip,
                            cuisineValue === item.value && { backgroundColor: 'rgba(29,161,242,0.3)' }
                          ]}
                        >
                          <Text style={styles.categoryChipText}>{item.label}</Text>
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                  )}
                </View>
              </View>

              {/* Ingredients */}
              <View style={styles.formSection}>
                <Text style={styles.sectionTitle}>Ingredients</Text>
                {ingredients.map((ing, i) => {
                  if (!unitWidthRefs.current[i]) {
                    unitWidthRefs.current[i] = new Animated.Value(0);
                  }
                  return (
                    <View key={i} style={{ marginBottom: 20 }}>
                      <Text style={styles.inputLabel}>Ingredient {i + 1} Name</Text>
                      <View style={styles.inputContainer}>
                        <View style={styles.inputRow}>
                        <TextInput
  placeholder={`Ingredient ${i + 1}`}
  placeholderTextColor="#888"
  value={ing.name}
  onChangeText={(text) => {
    const newList = [...ingredients];
    newList[i].name = removeNewlines(text);
    setIngredients(newList);

    // If this row is the active one, fetch suggestions
    if (activeIngredientIndex === i) {
      debouncedFetchIngredientSuggestions(text);
    }
  }}
  style={[styles.input, { flex: 1 }]}
  returnKeyType="next"
  blurOnSubmit={false}
  ref={(el) => (ingredientRefs.current[i * 2] = el)}
  onSubmitEditing={() => {
    // Focus quantity input
    if (ingredientRefs.current[i * 2 + 1]) {
      ingredientRefs.current[i * 2 + 1].focus();
    }
  }}
  editable={!isUploading}
  onFocus={() => {
    setActiveIngredientIndex(i);
    scrollToInput({ current: ingredientRefs.current[i * 2] });
  }}
  
  // NEW: Force user to pick from suggestions
  onEndEditing={() => {
    // If the user typed something but it doesn't match suggestions, reset
    if (ing.name.trim()) {
      if (!isSuggestionMatch(ing.name, ingredientSuggestions)) {
        Alert.alert(
          'Invalid Ingredient',
          'Please select an ingredient from the list.'
        );
        const newList = [...ingredients];
        newList[i].name = '';
        setIngredients(newList);
      }
    }
  }}
/>

                        </View>

                        {/* Suggestions for active row */}
                        {i === activeIngredientIndex && (
                          <>
                            {isFetchingSuggestions && (
                              <ActivityIndicator size="small" color="#1DA1F2" style={{ marginTop: 5 }} />
                            )}
{ingredientSuggestions.length > 0 && (
  <View style={styles.suggestionsList}>
    {/* Always show the FIRST suggestion */}
    <TouchableOpacity
      key={`${ingredientSuggestions[0].fdcId}-0`}
      onPress={() => {
        const newList = [...ingredients];
        newList[i].name = ingredientSuggestions[0].description || '';
        setIngredients(newList);
        setIngredientSuggestions([]);
      }}
      style={{ marginVertical: 4 }}
    >
      <Text style={{ color: '#fff' }}>{ingredientSuggestions[0].description}</Text>
    </TouchableOpacity>

    {/* If there's more than one suggestion, allow "Show more" */}
    {ingredientSuggestions.length > 1 && !showMoreIndices.includes(i) && (
      <TouchableOpacity
        onPress={() => handleShowMore(i)}
        style={{ marginTop: 5 }}
      >
        <Text style={{ color: '#1DA1F2' }}>Show more...</Text>
      </TouchableOpacity>
    )}

    {/* Once "Show more" is active for this row, show the rest */}
    {showMoreIndices.includes(i) && ingredientSuggestions.slice(1).map((item, sIndex) => (
      <TouchableOpacity
        key={`${item.fdcId}-${sIndex+1}`}
        onPress={() => {
          const newList = [...ingredients];
          newList[i].name = item.description || '';
          setIngredients(newList);
          setIngredientSuggestions([]);
        }}
        style={{ marginVertical: 4 }}
      >
        <Text style={{ color: '#fff' }}>{item.description}</Text>
      </TouchableOpacity>
    ))}
  </View>
)}

                          </>
                        )}
                      </View>

                      <Text style={styles.inputLabel}>Quantity</Text>
                      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <View style={[styles.inputContainer, { width: 80, marginRight: 5 }]}>
                          <View style={styles.inputRow}>
                            <TextInput
                              placeholder="e.g. 2"
                              placeholderTextColor="#888"
                              value={ing.quantity}
                              onChangeText={(txt) => {
                                const newList = [...ingredients];
                                newList[i].quantity = removeNewlines(txt);
                                setIngredients(newList);
                              }}
                              style={[styles.input, { flex: 1 }]}
                              keyboardType="numeric"
                              returnKeyType="next"
                              blurOnSubmit={false}
                              ref={el => (ingredientRefs.current[i * 2 + 1] = el)}
                              onSubmitEditing={() => Keyboard.dismiss()}
                              editable={!isUploading}
                              onFocus={() => scrollToInput({ current: ingredientRefs.current[i * 2 + 1] })}
                            />
                          </View>
                        </View>

                        {ing.unitLocked && ing.unit ? (
                          <Animated.View
                            style={[
                              styles.inputContainer,
                              {
                                width: unitWidthRefs.current[i],
                                backgroundColor: 'rgba(29,161,242,0.3)',
                                overflow: 'hidden',
                                height: 40,
                                alignItems: 'center',
                                justifyContent: 'center'
                              },
                            ]}
                          >
                            <TouchableOpacity
                              onPress={() => {
                                const newList = [...ingredients];
                                newList[i].unitLocked = false;
                                setIngredients(newList);
                              }}
                            >
                              <Text style={{ color: '#fff' }}>{ing.unit}</Text>
                            </TouchableOpacity>
                          </Animated.View>
                        ) : (
                          <Animated.View
                            style={[
                              styles.inputContainer,
                              {
                                width: unitWidthRefs.current[i],
                                overflow: 'hidden',
                              },
                            ]}
                          >
                            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                              {metrics.map(m => (
                                <TouchableOpacity
                                  key={m}
                                  onPress={() => {
                                    const newList = [...ingredients];
                                    if (newList[i].unit === m && newList[i].unitLocked) {
                                      newList[i].unitLocked = false;
                                    } else {
                                      newList[i].unit = m;
                                      newList[i].unitLocked = true;
                                    }
                                    setIngredients(newList);
                                  }}
                                  style={[
                                    styles.unitChip,
                                    ing.unit === m && { backgroundColor: 'rgba(29,161,242,0.3)' }
                                  ]}
                                >
                                  <Text style={{ color: '#fff', textAlign: 'center' }}>{m}</Text>
                                </TouchableOpacity>
                              ))}
                            </ScrollView>
                          </Animated.View>
                        )}
                      </View>

                      {ingredients.length > 1 && (
                        <TouchableOpacity
                          onPress={() => removeIngredient(i)}
                          disabled={isUploading}
                          style={styles.removeButton}
                        >
                          <Image source={CloseIcon} style={styles.smallIcon} />
                          <Text style={{ color: '#1DA1F2', marginLeft: 5 }}>Remove Ingredient</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  );
                })}
                <TouchableOpacity onPress={addIngredient} disabled={isUploading} style={styles.addButton}>
                  <Image source={PlusIcon} style={styles.smallIcon} />
                  <Text style={styles.addButtonText}>Add Ingredient</Text>
                </TouchableOpacity>
              </View>

              {/* Steps */}
              <View style={styles.formSection}>
                <Text style={styles.sectionTitle}>Steps</Text>
                {steps.map((s, i) => (
                  <View key={i} style={{ marginBottom: 20 }}>
                    <Text style={styles.inputLabel}>Step {i + 1}</Text>
                    <View style={styles.inputContainer}>
                      <View style={styles.inputRow}>
                        <TextInput
                          placeholder={`Step ${i + 1}`}
                          placeholderTextColor="#888"
                          value={s}
                          onChangeText={(txt) => {
                            const newSteps = [...steps];
                            newSteps[i] = removeNewlines(txt);
                            setSteps(newSteps);
                          }}
                          style={[styles.input, { flex: 1, paddingRight: 50 }]}
                          multiline
                          blurOnSubmit={false}
                          returnKeyType="next"
                          ref={ref => (stepRefs.current[i] = ref)}
                          editable={!isUploading}
                          onFocus={() => scrollToInput({ current: stepRefs.current[i] })}
                          {...conditionalProps(true, () => {
                            if (i < steps.length - 1) {
                              stepRefs.current[i + 1]?.focus();
                              setTimeout(() => scrollToInput({ current: stepRefs.current[i + 1] }), 50);
                            } else {
                              addStep();
                            }
                          })}
                        />
                        <View style={styles.wordCountWrapper}>
                          <WordCountCircle maxChars={STEP_MAX_CHARS} text={steps[i]} />
                        </View>
                      </View>
                    </View>
                    {steps.length > 1 && (
                      <TouchableOpacity
                        onPress={() => removeStep(i)}
                        disabled={isUploading}
                        style={styles.removeButton}
                      >
                        <Image source={CloseIcon} style={styles.smallIcon} />
                        <Text style={{ color: '#1DA1F2', marginLeft: 5 }}>Remove Step</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                ))}
                <TouchableOpacity onPress={addStep} disabled={isUploading} style={[styles.addButton, { marginTop: 20 }]}>
                  <Image source={PlusIcon} style={styles.smallIcon} />
                  <Text style={styles.addButtonText}>Add Step</Text>
                </TouchableOpacity>
              </View>

              {/* Tags */}
              <View style={styles.formSection}>
                <Text style={styles.sectionTitle}>Tags</Text>
                {renderTags(tags, setTags)}
                <Text style={styles.inputLabel}>Add a tag</Text>
                <View style={styles.inputContainer}>
                  <View style={styles.inputRow}>
                    <TextInput
                      placeholder="Enter a tag and press return"
                      placeholderTextColor="#888"
                      value={tagInput}
                      onChangeText={setTagInput}
                      style={[styles.input, { flex: 1 }]}
                      returnKeyType="done"
                      blurOnSubmit={false}
                      ref={tagRef}
                      onSubmitEditing={handleAddTag}
                      editable={!isUploading && tags.length < TAG_MAX_LENGTH}
                    />
                  </View>
                </View>

                <Text style={styles.sectionTitle}>Dietary</Text>
                {renderTags(dietaryTags, setDietaryTags)}
                <Text style={styles.inputLabel}>Add a dietary tag</Text>
                <View style={styles.inputContainer}>
                  <View style={styles.inputRow}>
                    <TextInput
                      placeholder="Enter a dietary tag and press return"
                      placeholderTextColor="#888"
                      value={dietTagInput}
                      onChangeText={setDietTagInput}
                      style={[styles.input, { flex: 1 }]}
                      returnKeyType="done"
                      blurOnSubmit={false}
                      ref={dietRef}
                      onSubmitEditing={handleAddDietTag}
                      editable={!isUploading && dietaryTags.length < DIET_TAG_MAX_LENGTH}
                    />
                  </View>
                </View>
              </View>

              {/* Dish Image */}
              <View style={styles.formSection}>
                <Text style={styles.sectionTitle}>Dish Image</Text>
                {dishImageUri ? (
                  <>
                    <Image source={{ uri: dishImageUri }} style={styles.dishImagePreview} />
                    <TouchableOpacity
                      style={styles.editCoverButton}
                      onPress={handleEditDishImage}
                      disabled={isUploading}
                    >
                      <Text style={styles.editCoverText}>Edit Image</Text>
                    </TouchableOpacity>
                  </>
                ) : (
                  <TouchableOpacity
                    style={styles.uploadDishImageButton}
                    onPress={handleAddDishImage}
                    disabled={isUploading}
                  >
                    <Image source={CameraIcon} style={styles.smallIcon} />
                    <Text style={styles.uploadDishImageText}>Select Image</Text>
                  </TouchableOpacity>
                )}
              </View>

              {/* Share Button */}
              <View style={[styles.formSection, { paddingBottom: 60 }]}>
                {isUploading ? (
                  <View style={{ alignItems: 'center' }}>
                    <ActivityIndicator size="large" color="#1DA1F2" />
                    <Text style={{ color: '#1DA1F2', marginTop: 10 }}>
                      Uploading... {uploadProgress}%
                    </Text>
                  </View>
                ) : (
                  <TouchableOpacity onPress={handleShare} style={styles.shareButtonMain}>
                    <Text style={styles.shareButtonText}>Share Recipe</Text>
                  </TouchableOpacity>
                )}
              </View>
            </Animated.View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

export default PostUpload;

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#121212' },
  header: {
    height: 50,
    backgroundColor: '#121212',
    alignItems: 'center',
    justifyContent: 'center',
  },
  backButton: { position: 'absolute', left: 10, top: 13 },
  headerIcon: { width: 24, height: 24 },
  headerTitle: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  scrollContainer: { padding: 20 },
  thumbnailContainer: {
    width: 170,
    height: 300,
    borderRadius: 10,
    backgroundColor: '#333',
    alignSelf: 'center',
    marginBottom: 20,
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingThumbnailContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  thumbnailOverlay: { width: '100%', height: '100%', resizeMode: 'cover' },
  editCoverButton: {
    position: 'absolute',
    bottom: 10,
    backgroundColor: 'rgba(50,50,50,0.8)',
    borderRadius: 15,
    paddingVertical: 5,
    paddingHorizontal: 15,
    alignSelf: 'center',
  },
  editCoverText: { color: '#ccc', fontSize: 14, fontWeight: '600' },
  framesPlusContainer: {
    width: 60, height: 60, borderRadius: 30,
    backgroundColor: '#1E1E1E', marginLeft: 20,
    alignItems: 'center', justifyContent: 'center',
  },
  framesContainer: {
    position: 'relative',
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: '#1E1E1E',
    marginHorizontal: 10,
    padding: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkButtonContainer: {
    width: 60, height: 60, borderRadius: 30,
    backgroundColor: '#1E1E1E', marginRight: 20,
    alignItems: 'center', justifyContent: 'center',
  },
  iconInside: { width: 24, height: 24, tintColor: '#888' },
  loadingIndicatorContainer: {
    position: 'absolute',
    top: windowHeight * 0.3,
    left: windowWidth / 2 - 50,
    width: 100,
    alignItems: 'center',
  },
  durationWindowAndFramesLineContainer: {
    marginTop: 10,
    width: '100%',
    height: TILE_HEIGHT + DURATION_WINDOW_BORDER_WIDTH * 2,
    justifyContent: 'center',
  },
  durationWindow: {
    width: DURATION_WINDOW_WIDTH,
    height: TILE_HEIGHT + 10,
    borderColor: 'yellow',
    borderWidth: DURATION_WINDOW_BORDER_WIDTH,
    borderRadius: 4,
    alignSelf: 'center',
    position: 'absolute',
    zIndex: 50,
    top: -5,
    overflow: 'hidden',
  },
  currentFrameImage: { width: '100%', height: '100%' },
  loadingFrame: {
    width: TILE_WIDTH,
    height: TILE_HEIGHT,
    backgroundColor: 'rgba(0,0,0,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.1)',
  },
  formSection: {
    backgroundColor: '#1E1E1E',
    borderRadius: 10,
    padding: 20,
    marginBottom: 20,
  },
  sectionTitle: { color: '#fff', fontSize: 18, fontWeight: '600', marginBottom: 15 },
  inputLabel: { color: '#aaa', fontSize: 14, marginBottom: 5, marginLeft: 2 },
  inputContainer: {
    backgroundColor: '#2A2A2A',
    borderRadius: 8,
    borderColor: '#2A2A2A',
    borderWidth: 1,
    marginBottom: 20,
  },
  inputRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
  input: { color: '#fff', paddingHorizontal: 15, paddingVertical: 15, fontSize: 16 },
  lockedCategoryContainer: {
    backgroundColor: 'rgba(29,161,242,0.3)',
    borderRadius: 8,
    height: 50,
    justifyContent: 'center',
    alignItems: 'center'
  },
  lockedCategoryText: { color: '#fff', fontSize: 14, textAlign: 'center' },
  categoryChip: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: '#2A2A2A',
    borderRadius: 8,
    marginRight: 5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  categoryChipText: { color: '#fff', fontSize: 14 },
  removeButton: { flexDirection: 'row', alignItems: 'center', marginTop: 10 },
  addButton: { flexDirection: 'row', alignItems: 'center', marginBottom: 20 },
  addButtonText: { color: '#1DA1F2', marginLeft: 5, fontSize: 16 },
  smallIcon: { width: 16, height: 16, tintColor: '#1DA1F2' },
  tagsContainer: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 10 },
  tagChip: {
    flexDirection: 'row',
    backgroundColor: '#333',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 15,
    marginRight: 5,
    marginBottom: 5,
    alignItems: 'center',
  },
  tagText: { color: '#fff', marginRight: 5 },
  tagCloseIcon: { width: 12, height: 12, tintColor: '#fff' },
  suggestionsList: {
    backgroundColor: '#2A2A2A',
    marginTop: 5,
    borderRadius: 5,
    padding: 8,
  },
  unitChip: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: '#2A2A2A',
    borderRadius: 8,
    marginRight: 5,
  },
  uploadDishImageButton: {
    marginTop: 10,
    backgroundColor: '#2A2A2A',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 5,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
  },
  uploadDishImageText: { color: '#fff', marginLeft: 5, fontSize: 14 },
  dishImagePreview: {
    width: '100%',
    height: 200,
    borderRadius: 10,
    marginBottom: 30,
    marginTop: 10,
  },
  shareButtonMain: {
    backgroundColor: '#1DA1F2',
    padding: 20,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 10,
  },
  shareButtonText: { color: '#fff', fontSize: 18, fontWeight: '600' },
  authContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
  authText: { color: '#ccc', fontSize: 16, marginBottom: 20, textAlign: 'center' },
  authButton: {
    backgroundColor: '#1DA1F2',
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 25,
  },
  authButtonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  wordCountCircle: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 2,
    backgroundColor: 'transparent',
    justifyContent: 'center',
    alignItems: 'center',
  },
  wordCountWrapper: { marginRight: 10 },
});
